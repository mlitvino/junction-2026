import "server-only";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { callModel, isAgentTestMode, requireGeminiApiKey } from "@/server/agents/mode";
import {
  orderChangeAgent,
  type ParsedOrderChange,
  ParsedOrderChangeSchema,
  parseOrderChangeDeterministically,
} from "@/server/agents/order-change-agent";
import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { purchaseOrder, valioProduct } from "@/server/db/schema";
import { getMastra } from "@/server/mastra";
import { mergeDraftLines } from "@/server/policy/evaluate";
import {
  getAvailability,
  getPrices,
  getProductSummaries,
  getUnitFacts,
  searchProducts,
} from "@/server/services/catalog";
import { extractProductsFromPrompt, inferProductType } from "@/server/services/extract";
import {
  classifyStockStatus,
  resolveUnifiedCatalogRecord,
  todayIsoDate,
} from "@/server/services/inquiry";
import {
  isSyntheticId,
  realProductFacts,
  MOCK_CATALOG_PRODUCTS,
  roundCurrency,
  syntheticCatalogEnabled,
  type UnifiedCatalogRecord,
} from "@/server/services/mock-catalog";
import { getEffectiveFor } from "@/server/services/preferences";
import {
  createProposal,
  getProposal,
  PurchasingError,
  reviseProposal,
  type Actor,
} from "@/server/services/purchasing";
import { rankCandidates } from "@/server/purchasing/ranking";
import {
  makeStep,
  stepDetails,
  withPricingSteps,
  type StoryKey,
  type StoryKind,
} from "@/server/purchasing/story";
import {
  GENERIC_MODIFIERS,
  SYNONYM_LOOKUP,
  computeNameMatchScore,
  selectRelevantCandidates,
  wordStems,
} from "@/server/search/name-match";
import { ValioApiError } from "@/server/valio/client";
import { toSalesUnits, type Conversion, type UnitFacts } from "@/server/valio/units";
import { allergenCodes, allergenNames } from "@/shared/contracts/allergens";
import type { Preferences } from "@/shared/contracts/preferences";
import type {
  ProductSummary,
  RankedProduct,
  RankProductsRequest,
  RankProductsResponse,
} from "@/shared/contracts/products";
import type { ExtractedProductItem } from "@/shared/contracts/extract";
import type {
  CandidateProduct,
  CustomerPreferences,
  ItemProcurementTrace,
  NutritionPreferences,
  PreviousOrderRecord,
  RemovedCandidate,
  StoryStep,
  SuggestedAlternative,
} from "@/shared/contracts/selection";
import type {
  CreateProposalFromPromptRequest,
  Proposal,
  ProposalFromPromptResponse,
  ProposalSelection,
  ProposalSource,
  ReviseProposalRequest,
  ReviseProposalResponse,
} from "@/shared/contracts/purchasing";

import type { AuditEntry } from "./audit";

// The purchasing agent's product selection: from a prompt (or recipe needs) to an A proposal.
//   extract items → candidates by product type (real catalog, real prices) → match score →
//   drop candidates that break the organization's dietary/allergen rules → rank by order history →
//   optional split over alternatives when stock is short → drift warnings → createProposal().
// Pricing, availability, the policy decision, approval and ordering are the purchasing flow's job
// (services/purchasing.ts), so prompt-made proposals obey exactly the same rules as any other.

type Draft = {
  selected: CandidateProduct;
  requestedProductName: string;
  quantity: number;
  unit: string;
  substituteFor: { requested: string; reason: "split" | "swap" | "fallback" } | null;
  conversion: Conversion | null;
};

/** Selection steps recorded in the audit log before the proposal is created. */
type PreparationStep = Omit<AuditEntry, "resourceType" | "resourceId">;

/** Records one selection step (keeps the pipeline code readable). */
function makeAuditEvent(params: {
  orderId: string;
  actorType: "agent" | "buyer" | "approver" | "system";
  actorId?: string | null;
  actorName?: string | null;
  eventType: string;
  summary: string;
  details?: Record<string, unknown>;
  /** The story step this entry belongs to; adds `story`, `step` and `stepKey` to the details. */
  story?: { kind: StoryKind; key: StoryKey; item?: string };
}): PreparationStep {
  const details = params.details ?? {};
  return {
    action: `agent.${params.eventType}`,
    summary: params.summary,
    details: params.story
      ? { ...stepDetails(params.story.kind, params.story.key, details), ...(params.story.item ? { item: params.story.item } : {}) }
      : details,
    actorType: params.actorType === "system" ? "system" : "agent",
  };
}

/** The organization's buyer rules, in the shape the candidate filter uses. */
export async function customerPreferencesFor(organizationId: string): Promise<CustomerPreferences> {
  return toCustomerPreferences((await getEffectiveFor(organizationId, "buyer")).values);
}

/** Same, from already-loaded effective buyer preferences (no second database round trip). */
export function toCustomerPreferences(effective: Preferences): CustomerPreferences {
  return {
    dietaryRestrictions: effective.dietaryRestrictions,
    // Candidates are tagged with allergen names; preferences may hold names or GS1 codes.
    excludedAllergens: allergenNames([...allergenCodes(effective.excludedAllergens)]),
    nutrition: nutritionLimitsOf(effective),
  };
}

/** The organization's nutrition limits per 100 g/ml; unset (null or absent) limits are left out. */
export function nutritionLimitsOf(
  rules: Partial<Pick<Preferences, "maxCaloriesPer100g" | "maxFatPer100g" | "maxSugarPer100g" | "maxSaltPer100g" | "minProteinPer100g">>,
): NutritionPreferences {
  const limits: NutritionPreferences = {};
  if (rules.maxCaloriesPer100g != null) limits.maxCaloriesPer100g = rules.maxCaloriesPer100g;
  if (rules.maxFatPer100g != null) limits.maxFatPer100g = rules.maxFatPer100g;
  if (rules.maxSugarPer100g != null) limits.maxSugarPer100g = rules.maxSugarPer100g;
  if (rules.maxSaltPer100g != null) limits.maxSaltPer100g = rules.maxSaltPer100g;
  if (rules.minProteinPer100g != null) limits.minProteinPer100g = rules.minProteinPer100g;
  return limits;
}

export const DEFAULT_MOCK_PREVIOUS_ORDERS: PreviousOrderRecord[] = [
  {
    orderId: "ORD-HIST-001",
    orderedAt: "2026-10-25T09:30:00.000Z",
    productId: "SYN-460101",
    productName: "Valio Oltermanni Creamy Cheese 1kg",
    brand: "Valio",
    quantity: 120,
  },
  {
    orderId: "ORD-HIST-002",
    orderedAt: "2026-11-01T14:15:00.000Z",
    productId: "SYN-460201",
    productName: "Valio Fresh Whole Milk 1L",
    brand: "Valio",
    quantity: 80,
  },
  {
    orderId: "ORD-HIST-003",
    orderedAt: "2026-11-05T11:00:00.000Z",
    productId: "SYN-460301",
    productName: "Arla Creamy Havarti Cheese 1kg",
    brand: "Arla",
    quantity: 50,
  },
];


/** Parses quantity string like "420 kg" or "50 L" into numeric amount and unit. */
export function parseQuantityAndUnit(
  rawQuantity: string,
  fallbackUnit = "KG",
): { quantity: number; unit: string } {
  const trimmed = rawQuantity.trim();
  const match = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(trimmed);
  if (!match) {
    return { quantity: 1, unit: fallbackUnit };
  }
  const num = Number.parseFloat(match[1]!.replace(",", "."));
  const quantity = Number.isFinite(num) && num > 0 ? num : 1;
  const unit = match[2]?.trim() || fallbackUnit;
  return { quantity, unit };
}

// Name matching lives in server/search/name-match.ts (shared with the product search); re-exported
// here so existing callers and tests keep importing it from the selection service.
export {
  GENERIC_MODIFIERS,
  NON_FOOD_CATEGORY_PREFIXES,
  applyCategoryVoting,
  computeNameMatchScore,
  filterFoodCandidatesIfAvailable,
  filterRelevantCandidates,
  isNonFoodProduct,
  selectRelevantCandidates,
  wordStems,
} from "@/server/search/name-match";

export type BuyerPreferenceRuleTarget = {
  dietaryTags: readonly string[];
  allergens: readonly string[];
  vendorName: string;
  co2PerKg?: number | null;
  deliveryReliability?: number | null;
  nutrition?: UnifiedCatalogRecord["nutrition"] | null;
};

export type BuyerPreferenceRules = Pick<
  Preferences,
  "dietaryRestrictions" | "excludedAllergens" | "blockedVendors" | "maxCo2PerKg" | "minDeliveryReliability"
> &
  Parameters<typeof nutritionLimitsOf>[0];

/**
 * Shared buyer-preference check used by product selection, product ranking, and proposal revision.
 * Checks dietary restrictions, excluded allergens (names or GS1 codes), blocked vendors,
 * max CO2 per kg, min delivery reliability, and optional nutrition limits.
 */
export function evaluateBuyerPreferences(
  product: BuyerPreferenceRuleTarget,
  rules: BuyerPreferenceRules,
  nutritionLimits?: NutritionPreferences,
): string[] {
  const reasons: string[] = [];

  const productDietary = new Set(product.dietaryTags.map((t) => t.toLowerCase()));
  for (const reqDiet of rules.dietaryRestrictions) {
    if (!productDietary.has(reqDiet.toLowerCase())) {
      reasons.push(`Missing required dietary restriction: ${reqDiet}`);
    }
  }

  if (rules.excludedAllergens.length > 0 && product.allergens.length > 0) {
    const banned = allergenCodes(rules.excludedAllergens);
    const seen = new Set<string>();
    for (const allergen of product.allergens) {
      const codes = allergenCodes([allergen]);
      if ([...codes].some((c) => banned.has(c))) {
        const display = allergenNames([allergen])[0] ?? allergen;
        if (!seen.has(display)) {
          seen.add(display);
          reasons.push(`Contains excluded allergen: ${display}`);
        }
      }
    }
  }

  if (rules.blockedVendors.includes(product.vendorName)) {
    reasons.push(`Vendor ${product.vendorName} is blocked`);
  }
  if (
    rules.maxCo2PerKg !== null &&
    product.co2PerKg !== null &&
    product.co2PerKg !== undefined &&
    product.co2PerKg > rules.maxCo2PerKg
  ) {
    reasons.push(`CO2 (${product.co2PerKg} kg/kg) exceeds maximum (${rules.maxCo2PerKg} kg/kg)`);
  }
  if (
    rules.minDeliveryReliability !== null &&
    product.deliveryReliability !== null &&
    product.deliveryReliability !== undefined &&
    product.deliveryReliability < rules.minDeliveryReliability
  ) {
    reasons.push(
      `Delivery reliability (${product.deliveryReliability}) is below minimum (${rules.minDeliveryReliability})`,
    );
  }

  const actual = product.nutrition;
  nutritionLimits ??= nutritionLimitsOf(rules);
  if (actual) {
    if (
      nutritionLimits.maxCaloriesPer100g !== undefined &&
      actual.caloriesPer100g > nutritionLimits.maxCaloriesPer100g
    ) {
      reasons.push(
        `Calories (${actual.caloriesPer100g} kcal/100g) exceed maximum (${nutritionLimits.maxCaloriesPer100g} kcal/100g)`,
      );
    }
    if (nutritionLimits.maxFatPer100g !== undefined && actual.fatPer100g > nutritionLimits.maxFatPer100g) {
      reasons.push(
        `Fat (${actual.fatPer100g}g/100g) exceeds maximum (${nutritionLimits.maxFatPer100g}g/100g)`,
      );
    }
    if (nutritionLimits.maxSugarPer100g !== undefined && actual.sugarPer100g > nutritionLimits.maxSugarPer100g) {
      reasons.push(
        `Sugar (${actual.sugarPer100g}g/100g) exceeds maximum (${nutritionLimits.maxSugarPer100g}g/100g)`,
      );
    }
    if (nutritionLimits.maxSaltPer100g !== undefined && actual.saltPer100g > nutritionLimits.maxSaltPer100g) {
      reasons.push(
        `Salt (${actual.saltPer100g}g/100g) exceeds maximum (${nutritionLimits.maxSaltPer100g}g/100g)`,
      );
    }
    if (
      nutritionLimits.minProteinPer100g !== undefined &&
      actual.proteinPer100g < nutritionLimits.minProteinPer100g
    ) {
      reasons.push(
        `Protein (${actual.proteinPer100g}g/100g) is below minimum (${nutritionLimits.minProteinPer100g}g/100g)`,
      );
    }
  }

  return reasons;
}

/**
 * Checks a candidate against customer preferences (Dietary restrictions, Allergens, Nutritions).
 * Returns an array of mismatch reasons (empty array = matches preferences).
 */
export function evaluateCustomerPreferences(
  candidate: Pick<UnifiedCatalogRecord, "dietaryTags" | "allergens" | "nutrition">,
  preferences: CustomerPreferences,
): string[] {
  return evaluateBuyerPreferences(
    { ...candidate, vendorName: "" },
    {
      dietaryRestrictions: preferences.dietaryRestrictions,
      excludedAllergens: preferences.excludedAllergens,
      blockedVendors: [],
      maxCo2PerKg: null,
      minDeliveryReliability: null,
    },
    preferences.nutrition,
  );
}


/**
 * The organization's recent ordered lines (last 20 orders), used to prefer known products and
 * brands and to spot unusual quantities. Demo history only alongside the synthetic catalog.
 */
export async function loadHistoricalOrderRecords(organizationId: string): Promise<PreviousOrderRecord[]> {
  await ensureDatabase();
  const d = getDb();
  const orders = await d
    .select({ id: purchaseOrder.id, createdAt: purchaseOrder.createdAt, lines: purchaseOrder.lines })
    .from(purchaseOrder)
    .where(eq(purchaseOrder.organizationId, organizationId))
    .orderBy(desc(purchaseOrder.createdAt))
    .limit(20);
  const ids = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)))];
  const brands = ids.length
    ? new Map(
        (await d.select({ id: valioProduct.id, brand: valioProduct.brand }).from(valioProduct).where(inArray(valioProduct.id, ids))).map(
          (r) => [r.id, r.brand],
        ),
      )
    : new Map<string, string | null>();
  const historical: PreviousOrderRecord[] = orders.flatMap((o) =>
    o.lines.map((l) => ({
      orderId: o.id,
      orderedAt: o.createdAt.toISOString(),
      productId: l.productId,
      productName: l.name,
      brand: brands.get(l.productId) ?? "",
      quantity: l.quantity,
    })),
  );
  return (await syntheticCatalogEnabled()) ? [...historical, ...DEFAULT_MOCK_PREVIOUS_ORDERS] : historical;
}

export type CandidateSearchPlan = {
  typeNorm: string;
  nameWords: string[];
  coreWords: string[];
  modifierBoostTerms: string[];
  primaryTermGroups: string[][];
  fallbackOrStems: string[];
  scoringQuery: string;
};

/**
 * Plans the SQL candidate search terms for `getCandidatesByProductType`.
 * Builds the primary AND over core (non-generic-modifier) word stems when at least one
 * core word exists, and a fallback OR over core stems of length >= 4 for multi-core-word queries
 * without requiring the English productType in the numeric ERP category column.
 */
export function planCandidateSearchTerms(productType: string, productName?: string): CandidateSearchPlan {
  const typeNorm = productType.trim().toLowerCase();
  const nameWords = (productName ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  const coreWords = nameWords.filter((w) => !GENERIC_MODIFIERS.has(w));
  const modifierWords = nameWords.filter((w) => GENERIC_MODIFIERS.has(w));
  const modifierBoostTerms = [
    ...new Set(
      modifierWords.flatMap((w) => {
        const syn = SYNONYM_LOOKUP.get(w);
        return syn ? [...syn] : wordStems(w);
      }),
    ),
  ];
  const primaryWords = coreWords.length > 0 ? coreWords : nameWords;
  const primaryTermGroups = primaryWords.map((w) => wordStems(w));
  const fallbackOrStems =
    coreWords.length > 1
      ? [...new Set(coreWords.flatMap((w) => wordStems(w)).filter((s) => s.length >= 4))]
      : [];
  const scoringQuery = (productName?.trim() || typeNorm).toLowerCase();

  return {
    typeNorm,
    nameWords,
    coreWords,
    modifierBoostTerms,
    primaryTermGroups,
    fallbackOrStems,
    scoringQuery,
  };
}

/** Pure filter for the synthetic catalog fallback (used when Postgres has no imported Valio catalog). */
export function filterSyntheticCatalogProducts<
  T extends Pick<UnifiedCatalogRecord, "productType" | "category" | "name">,
>(products: readonly T[], plan: Pick<CandidateSearchPlan, "typeNorm" | "coreWords">): T[] {
  if (!plan.typeNorm && plan.coreWords.length === 0) return [];
  return products.filter((p) => {
    const pt = p.productType.toLowerCase();
    const cat = p.category.toLowerCase();
    const nm = p.name.toLowerCase();
    if (
      plan.typeNorm &&
      (pt.includes(plan.typeNorm) ||
        (pt.length > 0 && plan.typeNorm.includes(pt)) ||
        cat.includes(plan.typeNorm) ||
        nm.includes(plan.typeNorm))
    ) {
      return true;
    }
    if (plan.coreWords.length > 0) {
      return plan.coreWords.every((w) => wordStems(w).some((s) => nm.includes(s) || pt.includes(s)));
    }
    return false;
  });
}

/** Most products priced per requested item (Valio price + availability lookups). */
const PRICE_LOOKUP_CAP = 40;

/**
 * Static pre-filter before live lookups: with a requested name, keeps the rows that pass the same
 * relevance pipeline the selection applies later (best first); without one, the first rows in SQL
 * (similarity) order. Never more than PRICE_LOOKUP_CAP.
 */
export function narrowBeforePricing<T extends { id: string; name: string; category: string; vatCode: string | null }>(
  rows: readonly T[],
  productName?: string,
): T[] {
  if (!productName?.trim()) return rows.slice(0, PRICE_LOOKUP_CAP);
  const scored = rows.map((r) => ({ id: r.id, category: r.category, vatCode: r.vatCode, nameMatchScore: computeNameMatchScore(productName, r.name) }));
  const score = new Map(
    selectRelevantCandidates(scored)
      .sort((a, b) => b.nameMatchScore - a.nameMatchScore)
      .slice(0, PRICE_LOOKUP_CAP)
      .map((c) => [c.id, c.nameMatchScore] as const),
  );
  return rows.filter((r) => score.has(r.id)).sort((a, b) => score.get(b.id)! - score.get(a.id)!);
}

export async function getCandidatesByProductType(
  productType: string,
  deliveryDate: string,
  /** The requested name ("lactose-free milk"): products containing all its core words come first. */
  productName?: string,
  /**
   * `strict`: a Valio failure is thrown (ValioApiError → 502 "Valio is unavailable") instead of
   * returning no priced candidates. Buying flows use it, so a Valio outage isn't reported to the
   * buyer as "no matching product"; background features (stock-out alerts, recommendations) don't.
   */
  options: { strict?: boolean } = {},
): Promise<UnifiedCatalogRecord[]> {
  const plan = planCandidateSearchTerms(productType, productName);
  const dbCandidates: UnifiedCatalogRecord[] = [];

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const escapeLike = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const likePattern = escapeLike(plan.typeNorm);
      const selectFields = {
        id: valioProduct.id,
        name: valioProduct.name,
        brand: valioProduct.brand,
        vendorName: valioProduct.vendorName,
        category: valioProduct.category,
        vatCode: valioProduct.vatCode,
        salesUnit: valioProduct.salesUnit,
        baseUnit: valioProduct.baseUnit,
        allowedLotSize: valioProduct.allowedLotSize,
        gtin: valioProduct.gtin,
        countryOfOrigin: valioProduct.countryOfOrigin,
        netWeightKg: valioProduct.netWeightKg,
        storageTempMin: valioProduct.storageTempMin,
        storageTempMax: valioProduct.storageTempMax,
        co2PerKg: valioProduct.co2PerKg,
        deliveryReliability: valioProduct.deliveryReliability,
        allergens: valioProduct.allergens,
        dietaryTags: valioProduct.dietaryTags,
        labels: valioProduct.labels,
        nutrition: valioProduct.nutrition,
      };
      const typeScope = or(ilike(valioProduct.category, likePattern), ilike(valioProduct.searchText, likePattern));
      const isFoodSql = sql`CASE WHEN LEFT(${valioProduct.category}, 2) NOT IN ('20','30','32','63','64','67','77','90') AND COALESCE(${valioProduct.vatCode}, '') NOT ILIKE '%STANDARD%' THEN 0.25 ELSE 0 END`;
      const modifierBoostSql =
        plan.modifierBoostTerms.length > 0
          ? sql`CASE WHEN ${or(...plan.modifierBoostTerms.map((t) => ilike(valioProduct.name, escapeLike(t))))} THEN 0.2 ELSE 0 END`
          : sql`0`;
      const orderBySimilarity = [
        plan.typeNorm
          ? sql`${isFoodSql} + ${modifierBoostSql} + (CASE WHEN ${valioProduct.searchText} ILIKE ${likePattern} THEN 0.1 ELSE 0 END) + similarity(${valioProduct.name}, ${plan.scoringQuery}) desc`
          : sql`${isFoodSql} + ${modifierBoostSql} + similarity(${valioProduct.name}, ${plan.scoringQuery}) desc`,
        asc(valioProduct.id),
      ] as const;

      let rows = await db
        .select(selectFields)
        .from(valioProduct)
        .where(
          plan.primaryTermGroups.length
            ? and(
                ...plan.primaryTermGroups.map((stems) =>
                  stems.length > 1
                    ? or(...stems.map((s) => ilike(valioProduct.searchText, escapeLike(s))))
                    : ilike(valioProduct.searchText, escapeLike(stems[0]!)),
                ),
              )
            : typeScope,
        )
        // Most similar to what was asked first (food + modifier hint + pg_trgm on English name), not alphabetical.
        .orderBy(...orderBySimilarity)
        .limit(200);

      // If a multi-core-word AND returns 0 rows, fall back to OR over core stems of length >= 4
      // without requiring the English productType in the numeric category column.
      if (rows.length === 0 && plan.fallbackOrStems.length > 0) {
        rows = await db
          .select(selectFields)
          .from(valioProduct)
          .where(or(...plan.fallbackOrStems.map((w) => ilike(valioProduct.searchText, escapeLike(w)))))
          .orderBy(...orderBySimilarity)
          .limit(200);
      }

      // Narrow down with the static data before asking Valio (undisclosed rate limits): only products
      // whose names can match the request are priced, at most PRICE_LOOKUP_CAP per item.
      rows = narrowBeforePricing(rows, productName);

      if (rows.length > 0) {
        const priceMap = new Map<string, { price: number; vat: number }>();
        const availMap = new Map<
          string,
          { available: number | null; model: "stock" | "terminal"; salesBlock: boolean; orderable: boolean; date: string | null }
        >();
        try {
          const [prices, availability] = await Promise.all([
            getPrices({ productIds: rows.map((r) => r.id), date: deliveryDate }),
            getAvailability({ productIds: rows.map((r) => r.id), date: deliveryDate }),
          ]);
          for (const q of prices.quotes) {
            if (q.found && q.priceExclVat !== null) {
              priceMap.set(q.productId, {
                price: q.priceExclVat,
                vat: q.vatRatePct ?? 14,
              });
            }
          }
          for (const a of availability.items) {
            availMap.set(a.productId, {
              available: a.salesBlock ? 0 : a.availableQuantity,
              model: a.logisticModel ?? "stock",
              salesBlock: a.salesBlock,
              orderable: a.orderable,
              date: a.availableDate,
            });
          }
        } catch (err) {
          if (options.strict && err instanceof ValioApiError) throw err;
          // Valio unavailable (non-strict callers): candidates without a real price are skipped below.
        }

        for (const r of rows) {
          const { dietaryTags, allergens, nutrition } = realProductFacts(r);
          const priceInfo = priceMap.get(r.id);
          const availInfo = availMap.get(r.id);
          // No real price, no candidate: a fixed-price order can't use an invented price.
          if (!priceInfo) continue;

          dbCandidates.push({
            id: r.id,
            name: r.name,
            productType,
            category: r.category,
            brand: r.brand,
            vendorName: r.vendorName,
            salesUnit: r.salesUnit,
            baseUnit: r.baseUnit,
            allowedLotSize: r.allowedLotSize,
            gtin: r.gtin,
            countryOfOrigin: r.countryOfOrigin,
            netWeightKg: r.netWeightKg,
            storageTempC:
              r.storageTempMin === null && r.storageTempMax === null
                ? null
                : { min: r.storageTempMin, max: r.storageTempMax },
            unitPriceEur: priceInfo.price,
            vatRatePct: priceInfo.vat,
            availableQuantity: availInfo ? availInfo.available : null,
            logisticModel: availInfo?.model ?? "stock",
            availableDate: availInfo?.date ?? null,
            salesBlock: availInfo?.salesBlock ?? false,
            orderable: availInfo ? availInfo.orderable : null,
            labels: r.labels,
            vatCode: r.vatCode,
            deliveryReliability: r.deliveryReliability,
            co2PerKg: r.co2PerKg,
            dietaryTags,
            allergens,
            nutrition,
            substituteIds: [],
          });
        }
      }
    } catch (err) {
      if (options.strict && err instanceof ValioApiError) throw err; // see `strict` above
      // Database unavailable or empty; fall back to mock catalog below.
    }
  }

  // Synthetic products only when there is no real catalog (dev without data), never mixed in.
  const useSynthetic = await syntheticCatalogEnabled();
  const matchingMocks = useSynthetic ? filterSyntheticCatalogProducts(MOCK_CATALOG_PRODUCTS, plan) : [];

  const mergedById = new Map<string, UnifiedCatalogRecord>();
  for (const item of [...matchingMocks, ...dbCandidates]) {
    if (!mergedById.has(item.id)) {
      mergedById.set(item.id, item);
    }
  }

  return [...mergedById.values()];
}

export function toCandidateProduct(params: {
  record: UnifiedCatalogRecord;
  nameMatchScore: number;
  previouslyOrderedProduct: boolean;
  previouslyOrderedBrand: boolean;
  requestedQuantity: number;
  deliveryDate: string;
}): CandidateProduct {
  const {
    record,
    nameMatchScore,
    previouslyOrderedProduct,
    previouslyOrderedBrand,
    requestedQuantity,
    deliveryDate,
  } = params;
  const orderable = record.availableQuantity === null || record.availableQuantity > 0;
  const { stockStatus } = classifyStockStatus({
    orderable,
    salesBlock: false,
    logisticModel: record.logisticModel,
    availableQuantity: record.availableQuantity,
    requestedQuantity,
  });

  return {
    id: record.id,
    name: record.name,
    productType: record.productType,
    category: record.category,
    brand: record.brand,
    vendorName: record.vendorName,
    salesUnit: record.salesUnit,
    unitPriceEur: record.unitPriceEur,
    unitPriceInclVatEur: roundCurrency(record.unitPriceEur * (1 + record.vatRatePct / 100)),
    vatRatePct: record.vatRatePct,
    availableQuantity: record.availableQuantity,
    stockStatus,
    earliestAvailableDate: deliveryDate,
    deliveryReliability: record.deliveryReliability,
    co2PerKg: record.co2PerKg,
    dietaryTags: record.dietaryTags,
    sustainabilityCertificates:
      record.sustainabilityCertificates ??
      [] /* no label data imported yet */,
    allergens: record.allergens,
    nutrition: record.nutrition,
    nameMatchScore,
    previouslyOrderedProduct,
    previouslyOrderedBrand,
  };
}


// ---------- Selection → proposal ----------

export type SelectionInput = {
  prompt: string | null;
  extractedItems: ExtractedProductItem[];
  deliveryDate: string;
  autoResolvePartialStock?: boolean;
  source: ProposalSource;
  /** Steps recorded before selection (e.g. prompt extraction, recipe reconciliation). */
  initialSteps?: PreparationStep[];
  /** Story steps recorded before selection (extract; or read recipe, total quantity, inventory). */
  initialStorySteps?: StoryStep[];
  /** Note stored on the proposal (defaults to the prompt). */
  note?: string;
};

/** Ranks products for every requested item and creates one proposal from the chosen lines. */
export async function createProposalFromItems(actor: Actor, input: SelectionInput): Promise<ProposalFromPromptResponse> {
  const { extractedItems, deliveryDate, autoResolvePartialStock } = input;
  const [previousOrders, rules] = await Promise.all([
    loadHistoricalOrderRecords(actor.organizationId),
    getEffectiveFor(actor.organizationId, "buyer").then((e) => e.values),
  ]);
  const preferences = toCustomerPreferences(rules);
  const orderId = "pending";
  const auditTrail: PreparationStep[] = [...(input.initialSteps ?? [])];
  const story: StoryKind = input.source === "recipe" ? "recipe_order" : "simple_buy";
  const storySteps: StoryStep[] = [...(input.initialStorySteps ?? [])];
  const actorId = actor.userId;
  const actorName = actor.userName;
  const previousProductIds = new Set(previousOrders.map((o) => o.productId.toLowerCase()));
  const previousProductNames = new Set(
    previousOrders.map((o) => o.productName.trim().toLowerCase()),
  );
  const previousBrands = new Set(previousOrders.map((o) => o.brand.trim().toLowerCase()));

  const pipeline: ItemProcurementTrace[] = [];
  const draftSelections: Draft[] = [];

  for (const item of extractedItems) {
    // Step 2: Get list of products by [Product type]
    // Products matching every word of the requested name; the product type only if none do.
    let rawByType = await getCandidatesByProductType(item.productType, deliveryDate, item.productName, { strict: true });
    if (!rawByType.length) rawByType = await getCandidatesByProductType(item.productType, deliveryDate, undefined, { strict: true });
    const { quantity, unit } = parseQuantityAndUnit(item.productQuantity, "");
    // The requested amount in each candidate's sales unit ("1000 L" → 200 cases of 5 L).
    const facts = await getUnitFacts(rawByType.filter((r) => !isSyntheticId(r.id)).map((r) => r.id));
    const convert = (id: string, amount: number): Conversion | null => {
      const f = facts.get(id);
      return f ? toSalesUnits(amount, unit, f) : null;
    };
    const conversionOf = new Map(rawByType.map((r) => [r.id, convert(r.id, quantity)]));

    auditTrail.push(
      makeAuditEvent({
        orderId,
        actorType: "agent",
        actorId,
        actorName,
        eventType: "catalog_searched",
        summary: `Searched catalog by product type '${item.productType}' for '${item.productName}': found ${rawByType.length} candidate(s).`,
        details: {
          productType: item.productType,
          requestedName: item.productName,
          candidateCount: rawByType.length,
        },
        story: { kind: story, key: "search_by_type", item: item.productName },
      }),
    );
    storySteps.push(
      makeStep(story, "search_by_type", {
        item: item.productName,
        status: rawByType.length ? "done" : "warning",
        summary: `Found ${rawByType.length} product(s) for '${item.productName}' by product type '${item.productType}'.`,
        details: { productType: item.productType, requestedName: item.productName, candidateCount: rawByType.length },
      }),
    );

    // Step 3: Score and sort list of best match by [Product name]
    const scoredByName: CandidateProduct[] = rawByType
      .map((record) => {
        const nameMatchScore = computeNameMatchScore(item.productName, record.name);
        const previouslyOrderedProduct =
          previousProductIds.has(record.id.toLowerCase()) ||
          previousProductNames.has(record.name.trim().toLowerCase());
        const previouslyOrderedBrand =
          record.brand !== null && previousBrands.has(record.brand.trim().toLowerCase());

        return toCandidateProduct({
          record,
          nameMatchScore,
          previouslyOrderedProduct,
          previouslyOrderedBrand,
          requestedQuantity: conversionOf.get(record.id)?.quantity ?? quantity,
          deliveryDate,
        });
      })
      .sort((a, b) => b.nameMatchScore - a.nameMatchScore || a.name.localeCompare(b.name));

    {
      const best = scoredByName.slice(0, 5).map((c) => ({ id: c.id, name: c.name, nameMatchScore: c.nameMatchScore }));
      const summary = best.length
        ? `Sorted ${scoredByName.length} product(s) by match with '${item.productName}': best '${best[0]!.name}' (${best[0]!.nameMatchScore.toFixed(2)}).`
        : `Nothing to sort for '${item.productName}'.`;
      auditTrail.push(
        makeAuditEvent({
          orderId,
          actorType: "agent",
          actorId,
          actorName,
          eventType: "name_sorted",
          summary,
          details: { requestedName: item.productName, best },
          story: { kind: story, key: "sort_by_name", item: item.productName },
        }),
      );
      storySteps.push(
        makeStep(story, "sort_by_name", {
          item: item.productName,
          status: best.length ? "done" : "warning",
          summary,
          details: { requestedName: item.productName, candidateCount: scoredByName.length, best },
        }),
      );
    }

    // Step 4: Remove entries that don't match buyer preferences (dietary, allergens, blocked vendors,
    // CO2, delivery reliability).
    const survivingCandidates: CandidateProduct[] = [];
    const removedByPreferences: RemovedCandidate[] = [];

    for (const candidate of scoredByName) {
      const reasons = evaluateBuyerPreferences(candidate, rules, preferences.nutrition);
      if (reasons.length > 0) {
        removedByPreferences.push({
          id: candidate.id,
          name: candidate.name,
          brand: candidate.brand,
          reasons,
        });
      } else {
        survivingCandidates.push(candidate);
      }
    }

    auditTrail.push(
      makeAuditEvent({
        orderId,
        actorType: "agent",
        actorId,
        actorName,
        eventType: "preferences_filtered",
        summary: `Filtered candidates for '${item.productName}' against dietary/allergen/vendor/CO2/reliability preferences: ${survivingCandidates.length} compliant, ${removedByPreferences.length} excluded.`,
        details: {
          requestedName: item.productName,
          survivingCount: survivingCandidates.length,
          removedByPreferences,
        },
        story: { kind: story, key: "filter_preferences", item: item.productName },
      }),
    );
    storySteps.push(
      makeStep(story, "filter_preferences", {
        item: item.productName,
        status: scoredByName.length > 0 && survivingCandidates.length === 0 ? "warning" : "done",
        summary: `Checked ${scoredByName.length} product(s) for '${item.productName}' against dietary, allergen, nutrition and other rules: ${survivingCandidates.length} compliant, ${removedByPreferences.length} removed.`,
        details: {
          compliantCount: survivingCandidates.length,
          removed: removedByPreferences.slice(0, 20).map((r) => ({ id: r.id, name: r.name, reasons: r.reasons })),
          rules: {
            dietaryRestrictions: preferences.dietaryRestrictions,
            excludedAllergens: preferences.excludedAllergens,
            nutrition: preferences.nutrition,
          },
        },
      }),
    );

    // Only food products (when available) that match the request and dominant categories compete.
    const recordBy = new Map(rawByType.map((r) => [r.id, r]));
    const relevant = selectRelevantCandidates(
      survivingCandidates.map((c) => ({ ...c, vatCode: recordBy.get(c.id)?.vatCode ?? null })),
    );
    survivingCandidates.splice(0, survivingCandidates.length, ...relevant);

    // Step 5: Rank the compliant candidates: price per litre/kg, availability by the date,
    // relevance and history, reliability, CO2, organization preferences (server/purchasing/ranking.ts).
    const { ranked, unavailable } = rankCandidates(
      survivingCandidates.map((c) => {
        const r = recordBy.get(c.id)!;
        const conv = conversionOf.get(c.id);
        return {
          id: c.id,
          name: c.name,
          brand: c.brand,
          vendorName: c.vendorName,
          countryOfOrigin: r.countryOfOrigin,
          labels: r.labels ?? [],
          unitPriceExclVat: c.unitPriceEur,
          salesUnit: c.salesUnit,
          perSalesUnit: conv?.perSalesUnit ?? null,
          quantity: conv?.quantity ?? quantity,
          converted: unit ? (conv?.converted ?? false) : true,
          // Valio's verdict when we have it (same as the policy check uses), else derived from the stock.
          orderable:
            r.orderable ?? (r.availableQuantity === null ? null : r.availableQuantity > 0 || r.logisticModel === "terminal"),
          salesBlock: r.salesBlock ?? false,
          availableDate: r.availableDate ?? null,
          availableQuantity: r.availableQuantity,
          deliveryReliability: c.deliveryReliability ?? null,
          co2PerKg: c.co2PerKg ?? null,
          nameMatch: c.nameMatchScore,
          previouslyOrderedProduct: c.previouslyOrderedProduct,
          previouslyOrderedBrand: c.previouslyOrderedBrand,
        };
      }),
      {
        requestedDate: deliveryDate,
        preferredOriginCountries: rules.preferredOriginCountries,
        preferredVendors: rules.preferredVendors,
        preferredBrands: rules.preferredBrands,
      },
    );
    const candidateBy = new Map(survivingCandidates.map((c) => [c.id, c]));
    const sortedCandidates: CandidateProduct[] = [
      ...ranked.map((r) => ({ ...candidateBy.get(r.id)!, rankScore: r.score, rankReasons: r.reasons })),
      ...unavailable.map((u) => ({ ...candidateBy.get(u.id)!, rankScore: 0, rankReasons: [u.reason] })),
    ];
    const selectedProduct = ranked[0] ? sortedCandidates[0]! : null;
    // The best name match couldn't be delivered, so another product stands in for it.
    const bestMatch = [...survivingCandidates].sort((x, y) => y.nameMatchScore - x.nameMatchScore)[0];
    // Only a real delivery problem (sales block, nothing deliverable, no price) makes it a fallback,
    // not a product that merely can't take the requested unit.
    const bestMatchProblem = bestMatch ? unavailable.find((u) => u.id === bestMatch.id)?.reason : undefined;
    const fallback =
      !!selectedProduct && !!bestMatch && bestMatch.id !== selectedProduct.id && !!bestMatchProblem && !bestMatchProblem.includes("converted");
    const selectedConversion = selectedProduct ? conversionOf.get(selectedProduct.id) ?? null : null;
    const resolvedUnit = selectedProduct?.salesUnit || unit;

    auditTrail.push(
      makeAuditEvent({
        orderId,
        actorType: "agent",
        actorId,
        actorName,
        eventType: "candidates_ranked",
        summary: selectedProduct
          ? `Selected '${selectedProduct.name}' (${selectedProduct.id}) for '${item.productName}': ${ranked[0]!.reasons.join("; ")}.${
              selectedConversion ? ` ${selectedConversion.note}.` : ""
            }${fallback ? ` Stands in for '${bestMatch!.name}', which can't be delivered.` : ""}`
          : `No compliant, deliverable candidate for '${item.productName}'.`,
        details: {
          requestedName: item.productName,
          selectedProductId: selectedProduct?.id ?? null,
          ranking: ranked.slice(0, 5).map((r) => ({ id: r.id, name: r.name, score: r.score, tier: r.tier, reasons: r.reasons })),
          unavailable: unavailable.map((u) => ({ id: u.id, reason: u.reason })),
        },
        story: { kind: story, key: "sort_by_history", item: item.productName },
      }),
    );
    {
      const knownProducts = survivingCandidates.filter((c) => c.previouslyOrderedProduct).map((c) => c.id);
      const knownBrands = [...new Set(survivingCandidates.filter((c) => c.previouslyOrderedBrand && c.brand).map((c) => c.brand!))];
      const history = previousOrders.length > 0;
      storySteps.push(
        makeStep(story, "sort_by_history", {
          item: item.productName,
          status: !selectedProduct ? "warning" : history ? "done" : "skipped",
          summary: !selectedProduct
            ? `No compliant, deliverable product for '${item.productName}'.`
            : history
              ? `Ranked ${ranked.length} product(s) with the order history (${knownProducts.length} ordered before, ${knownBrands.length} known brand(s)) next to price, availability, reliability and CO2: chose '${selectedProduct.name}' (${selectedProduct.id}).`
              : `No previous orders to sort by; ranked by price, availability, reliability and CO2: chose '${selectedProduct.name}' (${selectedProduct.id}).`,
          details: {
            previousOrdersAvailable: history,
            previouslyOrderedProductIds: knownProducts,
            previouslyOrderedBrands: knownBrands,
            selectedProductId: selectedProduct?.id ?? null,
            ranking: ranked.slice(0, 5).map((r) => ({ id: r.id, name: r.name, score: r.score, tier: r.tier, reasons: r.reasons })),
            unavailable: unavailable.map((u) => ({ id: u.id, reason: u.reason })),
          },
        }),
      );
    }

    pipeline.push({
      extractedItem: item,
      parsedQuantity: quantity,
      parsedUnit: unit || resolvedUnit,
      orderedQuantity: selectedConversion?.quantity ?? (selectedProduct ? quantity : null),
      conversionNote: selectedConversion?.note ?? null,
      matchedByTypeCount: rawByType.length,
      removedByPreferences,
      sortedCandidates,
      selectedProduct,
    });

    if (selectedProduct) {
      const primaryQty = selectedConversion?.quantity ?? quantity;
      const primary = {
        selected: selectedProduct,
        requestedProductName: item.productName,
        quantity: primaryQty,
        unit: resolvedUnit,
        substituteFor: fallback ? { requested: item.productName, reason: "fallback" as const } : null,
        conversion: selectedConversion,
      };
      // Optional: split over compliant alternatives when known stock is short. Remaining need is
      // tracked in the requested amount and converted per product.
      const available = selectedProduct.availableQuantity;
      if (autoResolvePartialStock && available !== null && available !== undefined && available < primaryQty && ranked.length > 1) {
        const perSales = (q: number) => (primaryQty > 0 ? quantity / primaryQty : 1) * q; // requested units per sales unit
        let remaining = quantity;
        const allocations: { productId: string; name: string; allocated: number }[] = [];
        for (const r of ranked) {
          if (remaining <= 0) break;
          const cand = candidateBy.get(r.id)!;
          const need = r.id === selectedProduct.id ? primaryQty : (convert(r.id, remaining)?.quantity ?? Math.ceil(remaining));
          const cap = r.availableQuantity === null ? need : Math.max(0, Math.min(need, r.availableQuantity));
          if (cap <= 0) continue;
          draftSelections.push({
            selected: cand,
            requestedProductName: item.productName,
            quantity: cap,
            unit: cand.salesUnit || resolvedUnit,
            substituteFor: r.id === selectedProduct.id ? primary.substituteFor : { requested: item.productName, reason: "split" },
            conversion: conversionOf.get(r.id) ?? null,
          });
          allocations.push({ productId: cand.id, name: cand.name, allocated: cap });
          const covered = r.id === selectedProduct.id ? perSales(cap) : (convert(r.id, remaining)?.converted ? Math.min(remaining, (remaining / need) * cap) : cap);
          remaining = roundCurrency(remaining - covered);
        }
        auditTrail.push(
          makeAuditEvent({
            orderId,
            actorType: "agent",
            actorId,
            actorName,
            eventType: "partial_stock_split",
            summary: `Known stock of '${selectedProduct.name}' (${available} ${selectedProduct.salesUnit}) is below ${primaryQty}; split over ${allocations.length} compliant product(s): ${allocations
              .map((x) => `${x.allocated} of ${x.productId}`)
              .join(" + ")}${remaining > 0 ? `; ${remaining} ${unit || selectedProduct.salesUnit} still uncovered` : ""}.`,
            details: { requested: { quantity, unit }, allocations, uncovered: Math.max(0, remaining) },
          }),
        );
        if (!allocations.length) draftSelections.push(primary);
      } else {
        draftSelections.push(primary);
      }
    }
  }

  // Merge duplicate productIds in draftSelections before running inquiry
  const mergedDraftMap = new Map<string, Draft>();
  for (const d of draftSelections) {
    const prev = mergedDraftMap.get(d.selected.id);
    if (prev) {
      prev.quantity = roundCurrency(prev.quantity + d.quantity);
    } else {
      mergedDraftMap.set(d.selected.id, { ...d });
    }
  }
  const finalDrafts = [...mergedDraftMap.values()];

  // Drift check: quantities far above this organization's usual order of the same product.
  const warnings: string[] = [];
  for (const draft of finalDrafts) {
    const past = previousOrders.filter((h) => h.productId.toLowerCase() === draft.selected.id.toLowerCase());
    if (!past.length) continue;
    const sorted = past.map((h) => h.quantity).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const baseline = sorted.length % 2 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    if (baseline > 0 && draft.quantity / baseline >= 2.5) {
      const ratio = roundCurrency(draft.quantity / baseline);
      warnings.push(`${draft.selected.name}: ${draft.quantity} is ${ratio}x the usual ${baseline}.`);
      auditTrail.push(
        makeAuditEvent({
          orderId,
          actorType: "system",
          eventType: "recurring_anomaly_detected",
          summary: `Unusual quantity for '${draft.selected.name}': ${draft.quantity} vs usual ${baseline} (${ratio}x).`,
          details: { productId: draft.selected.id, proposed: draft.quantity, baseline, ratio },
        }),
      );
    }
  }
  // Amounts that couldn't be converted into the product's sales unit need a human look.
  for (const d of finalDrafts) {
    if (!d.conversion) warnings.push(`'${d.requestedProductName}': no packaging data for ${d.selected.name}; ordered ${d.quantity} ${d.unit}. Check the quantity.`);
    else if (!d.conversion.converted) warnings.push(`'${d.requestedProductName}': ${d.conversion.note}`);
  }
  for (const trace of pipeline) {
    if (trace.selectedProduct) continue;
    if (trace.sortedCandidates.length > 0) {
      warnings.push(`'${trace.extractedItem.productName}': no deliverable product found for ${deliveryDate}.`);
    } else if (trace.matchedByTypeCount > 0 && trace.removedByPreferences.length === trace.matchedByTypeCount) {
      warnings.push(
        `'${trace.extractedItem.productName}': all ${trace.removedByPreferences.length} candidate(s) were excluded by organization preferences.`,
      );
    } else {
      warnings.push(`'${trace.extractedItem.productName}': no matching product found in catalog.`);
    }
  }

  const suggestedAlternatives: SuggestedAlternative[] = finalDrafts.map((d) => ({
    forProductId: d.selected.id,
    forProductName: d.selected.name,
    alternatives: (pipeline.find((t) => t.selectedProduct?.id === d.selected.id)?.sortedCandidates ?? []).filter(
      (c) => c.id !== d.selected.id,
    ),
  }));
  const selection: ProposalSelection = {
    prompt: input.prompt,
    extractedItems,
    pipeline,
    suggestedAlternatives,
    previousOrdersUsed: previousOrders,
    warnings,
    steps: storySteps,
  };

  if (!finalDrafts.length) {
    return {
      proposal: null,
      selection,
      message: "No product matched the request and the organization's dietary and allergen rules. Adjust the request or the rules.",
    };
  }

  const proposal = await createProposal(
    actor,
    {
      lines: finalDrafts.map((d) => ({
        productId: d.selected.id,
        quantity: d.quantity,
        ...(d.substituteFor ? { substituteFor: d.substituteFor } : {}),
      })),
      date: deliveryDate,
      note: (input.note ?? input.prompt ?? undefined)?.slice(0, 1000),
    },
    {
      source: input.source,
      selection,
      preparation: auditTrail,
      // Steps 6 to 9 need the priced proposal: budget comparison, order, approval or change, checkout.
      onPriced: (priced) => {
        const steps = withPricingSteps(story, storySteps, priced);
        const budget = steps.find((s) => s.key === "compare_budget")!;
        return {
          selection: { ...selection, steps },
          preparation: [
            {
              action: "agent.budget_compared",
              summary: budget.summary,
              details: stepDetails(story, "compare_budget", budget.details ?? {}),
              actorType: "agent" as const,
            },
          ],
        };
      },
    },
  );
  return { proposal, selection: proposal.selection ?? selection, message: nextStepMessage(proposal) };
}

/** What happens next, in words a buyer or an agent can act on. */
export function nextStepMessage(proposal: Proposal): string {
  const total = proposal.totalExclVat === null ? "unknown total" : `€${proposal.totalExclVat.toFixed(2)} excl. VAT`;
  const reasons = proposal.decision.reasons.filter((r) => r.outcome !== "ALLOW").map((r) => r.message).join(" ");
  switch (proposal.decision.outcome) {
    case "DENY":
      return `Proposal ${proposal.id} (${total}) is blocked by the organization's rules: ${reasons}`;
    case "REQUIRE_APPROVAL":
      return `Proposal ${proposal.id} (${total}) needs an approver: ${reasons} Send it with POST /api/proposals/${proposal.id}/approval.`;
    default:
      return `Proposal ${proposal.id} (${total}) is within the organization's limits. Order it with POST /api/proposals/${proposal.id}/order.`;
  }
}

/** Prompt → extracted items → proposal. */
export async function createProposalFromPrompt(
  actor: Actor,
  input: CreateProposalFromPromptRequest,
): Promise<ProposalFromPromptResponse> {
  const extraction = await extractProductsFromPrompt({ prompt: input.prompt });
  return createProposalFromItems(actor, {
    prompt: input.prompt,
    extractedItems: extraction.items,
    deliveryDate: input.date ?? todayIsoDate(),
    autoResolvePartialStock: input.autoResolvePartialStock,
    source: "agent",
    initialSteps: [
      {
        action: "agent.prompt_extracted",
        summary: `Extracted ${extraction.items.length} item(s) from the request: ${
          extraction.items.map((i) => `${i.productQuantity} of '${i.productName}' (${i.productType})`).join("; ") || "none"
        }.`,
        details: stepDetails("simple_buy", "extract", { prompt: input.prompt, extractedItems: extraction.items }),
      },
    ],
    initialStorySteps: [
      makeStep("simple_buy", "extract", {
        status: extraction.items.length ? "done" : "warning",
        summary: `Extracted ${extraction.items.length} item(s) as [name] - [type] - [quantity]: ${
          extraction.items.map((i) => `${i.productName} - ${i.productType} - ${i.productQuantity}`).join("; ") || "none"
        }.`,
        details: { prompt: input.prompt, items: extraction.items },
      }),
    ],
  });
}

// ---------- Revising a proposal (structured or natural-language changes) ----------

type LineRef = { productId: string; name: string; requestedName: string };

function resolveLineTarget(target: string, lines: LineRef[]): LineRef | null {
  const norm = target.trim().toLowerCase();
  if (!norm || norm === "*") return lines[0] ?? null;
  const exact = lines.find((l) => l.productId.toLowerCase() === norm);
  if (exact) return exact;
  let best: { line: LineRef; score: number } | null = null;
  for (const line of lines) {
    const score = Math.max(computeNameMatchScore(target, line.name), computeNameMatchScore(target, line.requestedName));
    if (score > (best?.score ?? 0.25)) best = { line, score };
  }
  return best?.line ?? null;
}

async function resolveReplacementId(toTarget: string, pipeline: ItemProcurementTrace[], date: string): Promise<string | null> {
  const direct = await resolveUnifiedCatalogRecord(toTarget.trim(), date);
  if (direct) return direct.id;
  let best: { id: string; score: number } | null = null;
  for (const trace of pipeline)
    for (const cand of trace.sortedCandidates) {
      const score = computeNameMatchScore(toTarget, cand.name);
      if (score > (best?.score ?? 0.25)) best = { id: cand.id, score };
    }
  if (best) return best.id;
  const search = await searchProducts({ q: toTarget, limit: 20, offset: 0, sort: "relevance" });
  let bestSearch: { id: string; score: number } | null = null;
  for (const item of search.items) {
    const score = computeNameMatchScore(toTarget, item.name);
    if (!bestSearch || score > bestSearch.score) bestSearch = { id: item.id, score };
  }
  return bestSearch?.id ?? null;
}

const badRequest = (message: string) => new PurchasingError(400, "INVALID_CHANGE", message);

/**
 * Recomputes a replacement line's sales-unit quantity from the old line's amount using catalog unit
 * facts (`toSalesUnits`). The originally requested amount (`trace`) is used only while the line still
 * has the quantity the selection gave it; after the buyer changed it, the line's current quantity
 * counts. Falls back to `oldQuantity` plus a warning when the catalog has no content info or the
 * units are incompatible.
 */
export function computeReplacementQuantity(params: {
  repQuantity?: number;
  oldQuantity: number;
  oldUnit: string;
  oldName: string;
  newName: string;
  newSalesUnit: string;
  /** Pass only when this trace is the line's sole source (not a merge of several requests). */
  trace?: { parsedQuantity: number; parsedUnit: string; orderedQuantity?: number | null } | null;
  oldFacts?: UnitFacts | null;
  newFacts?: UnitFacts | null;
}): { quantity: number; conversionNote: string | null; warning: string | null } {
  if (params.repQuantity !== undefined) {
    return { quantity: params.repQuantity, conversionNote: null, warning: null };
  }

  let reqAmount = params.oldQuantity;
  let reqUnit = params.oldUnit;
  // The original request still describes the line only if converting it again gives the line's
  // current quantity; a revised quantity ("set to 20") means the current quantity counts.
  const t = params.trace;
  const traceUsable = !!t && t.parsedQuantity > 0 && !!t.parsedUnit;
  const lineUnchanged =
    traceUsable &&
    (params.oldFacts
      ? toSalesUnits(t!.parsedQuantity, t!.parsedUnit, params.oldFacts).quantity === params.oldQuantity
      : t!.orderedQuantity === undefined || t!.orderedQuantity === null || t!.orderedQuantity === params.oldQuantity);
  if (params.trace && lineUnchanged) {
    reqAmount = params.trace.parsedQuantity;
    reqUnit = params.trace.parsedUnit;
  } else if (params.oldFacts) {
    const oldConv = toSalesUnits(params.oldQuantity, params.oldUnit, params.oldFacts);
    if (oldConv.perSalesUnit) {
      reqAmount = roundCurrency(params.oldQuantity * oldConv.perSalesUnit.value);
      reqUnit = oldConv.perSalesUnit.unit;
    }
  }

  if (params.newFacts) {
    const conv = toSalesUnits(reqAmount, reqUnit, params.newFacts);
    if (conv.converted) {
      return { quantity: conv.quantity, conversionNote: conv.note, warning: null };
    }
    return {
      quantity: params.oldQuantity,
      conversionNote: conv.note,
      warning: `Replaced '${params.oldName}' with '${params.newName}': ${conv.note} Kept ${params.oldQuantity} ${params.newSalesUnit}; check the quantity.`,
    };
  }

  return {
    quantity: params.oldQuantity,
    conversionNote: null,
    warning: `Replaced '${params.oldName}' with '${params.newName}': no packaging data for ${params.newName}; kept ${params.oldQuantity} ${params.newSalesUnit}. Check the quantity.`,
  };
}

/**
 * Updates `oldSelection` so `pipeline`, `suggestedAlternatives`, and `warnings` reflect the
 * revised proposal's lines after swaps, quantity updates, removals, and additions.
 */
export function updateSelectionForRevision(params: {
  oldSelection: ProposalSelection | null;
  newLines: readonly { productId: string; quantity: number }[];
  replacements: readonly {
    fromProductId: string;
    toProduct: CandidateProduct;
    quantity: number;
    conversionNote?: string | null;
  }[];
  quantityUpdates: readonly { productId: string; quantity: number }[];
  removedProductIds: readonly string[];
  addedItems: readonly { product: CandidateProduct; quantity: number }[];
  appliedChanges: readonly string[];
  extraWarnings?: readonly string[];
}): ProposalSelection | null {
  const { oldSelection } = params;
  if (!oldSelection) return null;

  const pipeline: ItemProcurementTrace[] = oldSelection.pipeline.map((trace) => ({
    ...trace,
    sortedCandidates: [...trace.sortedCandidates],
    removedByPreferences: [...trace.removedByPreferences],
  }));

  for (const rep of params.replacements) {
    for (const trace of pipeline) {
      if (trace.selectedProduct?.id === rep.fromProductId) {
        trace.selectedProduct = rep.toProduct;
        trace.orderedQuantity = rep.quantity;
        if (rep.conversionNote !== undefined) {
          trace.conversionNote = rep.conversionNote;
        }
        if (!trace.sortedCandidates.some((c) => c.id === rep.toProduct.id)) {
          trace.sortedCandidates.unshift(rep.toProduct);
        }
      }
    }
  }

  for (const qu of params.quantityUpdates) {
    for (const trace of pipeline) {
      if (trace.selectedProduct?.id === qu.productId) {
        trace.orderedQuantity = qu.quantity;
      }
    }
  }

  // Sync orderedQuantity with merged newLines (e.g. when a swap merged two lines of the same productId).
  const qtyById = new Map(params.newLines.map((l) => [l.productId, l.quantity]));
  for (const trace of pipeline) {
    const id = trace.selectedProduct?.id;
    if (id && qtyById.has(id)) {
      trace.orderedQuantity = qtyById.get(id)!;
    }
  }

  const remainingIds = new Set(params.newLines.map((l) => l.productId));
  const removedSet = new Set(params.removedProductIds);
  const filteredPipeline = pipeline.filter((trace) => {
    const id = trace.selectedProduct?.id;
    if (!id) return true;
    if (removedSet.has(id) && !remainingIds.has(id)) return false;
    return remainingIds.has(id);
  });

  for (const add of params.addedItems) {
    const newQty = params.newLines.find((l) => l.productId === add.product.id)?.quantity ?? add.quantity;
    const existingTrace = filteredPipeline.find((t) => t.selectedProduct?.id === add.product.id);
    if (existingTrace) {
      existingTrace.orderedQuantity = newQty;
    } else {
      filteredPipeline.push({
        extractedItem: {
          productName: add.product.name,
          productType: add.product.productType,
          productQuantity: `${newQty} ${add.product.salesUnit}`.trim(),
        },
        parsedQuantity: newQty,
        parsedUnit: add.product.salesUnit,
        orderedQuantity: newQty,
        conversionNote: null,
        matchedByTypeCount: 1,
        removedByPreferences: [],
        sortedCandidates: [add.product],
        selectedProduct: add.product,
      });
    }
  }

  const seenAlt = new Set<string>();
  const suggestedAlternatives: SuggestedAlternative[] = [];
  for (const trace of filteredPipeline) {
    const sel = trace.selectedProduct;
    if (!sel || seenAlt.has(sel.id)) continue;
    seenAlt.add(sel.id);
    suggestedAlternatives.push({
      forProductId: sel.id,
      forProductName: sel.name,
      alternatives: trace.sortedCandidates.filter((c) => c.id !== sel.id),
    });
  }

  const warnings = [...oldSelection.warnings, ...(params.extraWarnings ?? [])];
  if (params.appliedChanges.length > 0) {
    warnings.push(`Revised by user: ${params.appliedChanges.join("; ")}`);
  }

  return {
    ...oldSelection,
    pipeline: filteredPipeline,
    suggestedAlternatives,
    warnings,
  };
}

/**
 * Applies changes to a proposal's lines and creates the revised proposal (the old one is
 * cancelled unless the revised proposal is BLOCKED by policy). Accepts structured changes
 * and/or a natural-language `prompt` ("change 469330 to 469386", "set 30 cases of milk",
 * "remove the oat drink").
 */
export async function reviseProposalFromRequest(
  actor: Actor,
  proposalId: string,
  input: ReviseProposalRequest,
): Promise<ReviseProposalResponse> {
  const current = await getProposal(actor, proposalId);
  const pipeline = current.selection?.pipeline ?? [];
  const requestedName = (productId: string) =>
    pipeline.find((t) => t.selectedProduct?.id === productId)?.extractedItem.productName ?? "";
  const refs: LineRef[] = current.lines.map((l) => ({ productId: l.productId, name: l.name, requestedName: requestedName(l.productId) }));
  const date = input.date ?? current.pricingDate;

  const replacements = [...(input.replacements ?? [])];
  const quantityUpdates = [...(input.quantityUpdates ?? [])];
  const removeProductIds = [...(input.removeProductIds ?? [])];
  const addItems = [...(input.addItems ?? [])];

  if (input.prompt) {
    let parsed: ParsedOrderChange;
    if (isAgentTestMode()) {
      parsed = parseOrderChangeDeterministically(input.prompt, refs);
    } else {
      requireGeminiApiKey();
      const agent = process.env.DATABASE_URL ? getMastra().getAgentById("order-change-agent") : orderChangeAgent;
      const context = [
        `Current proposal lines: ${JSON.stringify(current.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unit: l.salesUnit })))}`,
        `Available candidate alternatives: ${JSON.stringify(pipeline.flatMap((t) => t.sortedCandidates.map((c) => ({ id: c.id, name: c.name }))))}`,
        `Customer change request: ${input.prompt}`,
      ].join("\n");
      parsed = await callModel(async () => {
        const llm = await agent.generate(context, { structuredOutput: { schema: ParsedOrderChangeSchema } });
        return ParsedOrderChangeSchema.parse(llm.object);
      });
    }
    for (const rep of parsed.replacements) {
      const from = resolveLineTarget(rep.fromTarget, refs);
      if (!from) throw badRequest(`Could not find '${rep.fromTarget}' in the proposal.`);
      const to = await resolveReplacementId(rep.toTarget, pipeline, date);
      if (!to) throw badRequest(`Replacement '${rep.toTarget}' was not found in the catalog.`);
      replacements.push({ fromProductId: from.productId, toProductId: to, quantity: rep.quantity });
    }
    for (const qu of parsed.quantityUpdates) {
      const line = resolveLineTarget(qu.target, refs);
      if (!line) throw badRequest(`Could not find '${qu.target}' in the proposal.`);
      quantityUpdates.push({ productId: line.productId, quantity: qu.quantity });
    }
    for (const target of parsed.removeTargets) {
      const line = resolveLineTarget(target, refs);
      if (line) removeProductIds.push(line.productId);
    }
  }

  if (!replacements.length && !quantityUpdates.length && !removeProductIds.length && !addItems.length && !input.date)
    throw badRequest("No change was given or recognized in the request.");

  type Line = { productId: string; name: string; quantity: number; unit: string; substituteFor: Draft["substituteFor"] };
  const lines: Line[] = current.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    quantity: l.quantity,
    unit: l.salesUnit ?? "",
    substituteFor: l.substituteFor ?? null,
  }));
  const applied: string[] = [];
  const extraWarnings: string[] = [];
  const appliedReplacements: {
    fromProductId: string;
    toProduct: CandidateProduct;
    quantity: number;
    conversionNote?: string | null;
  }[] = [];
  const appliedAdditions: { product: CandidateProduct; quantity: number }[] = [];
  const rules = (await getEffectiveFor(actor.organizationId, "buyer")).values;
  const unitFactsMap = await getUnitFacts(
    [
      ...new Set([
        ...lines.map((l) => l.productId),
        ...replacements.map((r) => r.toProductId),
      ]),
    ].filter((id) => !isSyntheticId(id)),
  );

  for (const rep of replacements) {
    const idx = lines.findIndex((l) => l.productId === rep.fromProductId);
    if (idx === -1) throw badRequest(`Product ${rep.fromProductId} is not in the proposal.`);
    const record = await resolveUnifiedCatalogRecord(rep.toProductId, date);
    if (!record) throw badRequest(`Product ${rep.toProductId} has no price for ${date} or is not in the catalog.`);
    const violations = evaluateBuyerPreferences(record, rules);
    if (violations.length) throw badRequest(`${record.name} (${record.id}) breaks the organization's rules: ${violations.join("; ")}.`);
    const old = lines[idx]!;
    const traces = pipeline.filter((t) => t.selectedProduct?.id === old.productId);
    const trace = traces[0];
    const { quantity, conversionNote, warning } = computeReplacementQuantity({
      repQuantity: rep.quantity,
      oldQuantity: old.quantity,
      oldUnit: old.unit,
      oldName: old.name,
      newName: record.name,
      newSalesUnit: record.salesUnit,
      // A line merged from several requests has no single original amount: use its current quantity.
      trace: traces.length === 1 ? trace : null,
      oldFacts: unitFactsMap.get(old.productId) ?? null,
      newFacts: unitFactsMap.get(record.id) ?? null,
    });
    if (warning) extraWarnings.push(warning);
    // A swap stands in for what the line was for originally.
    lines[idx] = {
      productId: record.id,
      name: record.name,
      quantity,
      unit: record.salesUnit,
      substituteFor: { requested: old.substituteFor?.requested ?? old.name, reason: "swap" },
    };
    const toProduct = toCandidateProduct({
      record,
      nameMatchScore: trace ? computeNameMatchScore(trace.extractedItem.productName, record.name) : 1,
      previouslyOrderedProduct: false,
      previouslyOrderedBrand: false,
      requestedQuantity: quantity,
      deliveryDate: date,
    });
    appliedReplacements.push({
      fromProductId: rep.fromProductId,
      toProduct,
      quantity,
      conversionNote,
    });
    applied.push(`Replaced ${old.name} (${old.productId}) with ${record.name} (${record.id}), ${quantity} ${record.salesUnit}.`);
  }
  for (const qu of quantityUpdates) {
    const line = lines.find((l) => l.productId === qu.productId);
    if (!line) throw badRequest(`Product ${qu.productId} is not in the proposal.`);
    applied.push(`Changed ${line.name} (${line.productId}) from ${line.quantity} to ${qu.quantity} ${line.unit}.`);
    line.quantity = qu.quantity;
  }
  for (const id of new Set(removeProductIds)) {
    const idx = lines.findIndex((l) => l.productId === id);
    if (idx === -1) continue;
    applied.push(`Removed ${lines[idx]!.name} (${id}).`);
    lines.splice(idx, 1);
  }
  for (const add of addItems) {
    const record = await resolveUnifiedCatalogRecord(add.productId, date);
    if (!record) throw badRequest(`Product ${add.productId} has no price for ${date} or is not in the catalog.`);
    const violations = evaluateBuyerPreferences(record, rules);
    if (violations.length) throw badRequest(`${record.name} (${record.id}) breaks the organization's rules: ${violations.join("; ")}.`);
    const existing = lines.find((l) => l.productId === record.id);
    if (existing) existing.quantity = roundCurrency(existing.quantity + add.quantity);
    else lines.push({ productId: record.id, name: record.name, quantity: add.quantity, unit: record.salesUnit, substituteFor: null });
    appliedAdditions.push({
      product: toCandidateProduct({
        record,
        nameMatchScore: 1,
        previouslyOrderedProduct: false,
        previouslyOrderedBrand: false,
        requestedQuantity: add.quantity,
        deliveryDate: date,
      }),
      quantity: add.quantity,
    });
    applied.push(`Added ${add.quantity} ${record.salesUnit} of ${record.name} (${record.id}).`);
  }
  if (input.date && input.date !== current.pricingDate) applied.push(`Moved the delivery date from ${current.pricingDate} to ${input.date}.`);

  const mergedLines = mergeDraftLines(lines);

  const updatedSelection = updateSelectionForRevision({
    oldSelection: current.selection,
    newLines: mergedLines,
    replacements: appliedReplacements,
    quantityUpdates,
    removedProductIds: removeProductIds,
    addedItems: appliedAdditions,
    appliedChanges: applied,
    extraWarnings,
  });

  return reviseProposal(actor, proposalId, {
    lines: mergedLines.map((l) => ({ productId: l.productId, quantity: l.quantity, substituteFor: l.substituteFor })),
    date,
    appliedChanges: applied,
    selection: updatedSelection,
  });
}

// ---------- Ranking (POST /api/products/rank) ----------

/** The agent's candidates for a need, as product summaries, most relevant first. */
async function rankCandidatesFor(q: string, date: string): Promise<ProductSummary[]> {
  const records = await getCandidatesByProductType(inferProductType(q), date, q, { strict: true });
  const scored = records.map((r) => ({ id: r.id, category: r.category, vatCode: r.vatCode ?? null, nameMatchScore: computeNameMatchScore(q, r.name) }));
  const ids = selectRelevantCandidates(scored)
    .sort((a, b) => b.nameMatchScore - a.nameMatchScore)
    .map((c) => c.id);
  return getProductSummaries(ids);
}

/**
 * Good / better / best for a need ("1000 L of lactose-free milk"): candidates from the catalog,
 * the organization's rules (excluded allergens, dietary tags, blocked vendors, max CO2, min
 * reliability) applied, the amount converted per product, live prices and availability for the
 * date, then `rankCandidates`.
 */
export async function rankProducts(actor: Actor, req: RankProductsRequest): Promise<RankProductsResponse> {
  const date = req.date ?? todayIsoDate();
  const rules = (await getEffectiveFor(actor.organizationId, "buyer")).values;
  // With `q`: the same candidates the agent's selection uses (name-first search, static narrowing,
  // relevance gate), so the ranking and the agent recommend the same product for the same need.
  const found = req.productIds?.length
    ? await getProductSummaries(req.productIds)
    : await rankCandidatesFor(req.q!, date);

  const excluded: RankProductsResponse["excluded"] = [];
  const allowed: ProductSummary[] = [];
  for (const p of found) {
    const reasons = evaluateBuyerPreferences(p, rules);
    if (reasons.length) excluded.push({ product: p, reasons });
    else allowed.push(p);
  }
  // Rank every relevant candidate (as the agent does); `limit` only cuts the returned list.
  const candidates = allowed;
  const ids = candidates.map((p) => p.id);
  const [facts, prices, availability, history] = await Promise.all([
    getUnitFacts(ids),
    ids.length ? getPrices({ productIds: ids, date }) : null,
    ids.length ? getAvailability({ productIds: ids, date }) : null,
    loadHistoricalOrderRecords(actor.organizationId),
  ]);
  const priceBy = new Map((prices?.quotes ?? []).map((q) => [q.productId, q]));
  const availBy = new Map((availability?.items ?? []).map((a) => [a.productId, a]));
  const orderedIds = new Set(history.map((h) => h.productId));
  const orderedBrands = new Set(history.map((h) => h.brand.toLowerCase()).filter(Boolean));
  const conversions = new Map(
    candidates.map((p) => {
      const f = facts.get(p.id);
      const conv = f ? toSalesUnits(req.quantity, req.unit, f) : null;
      return [p.id, conv];
    }),
  );

  const { ranked, unavailable } = rankCandidates(
    candidates.map((p) => {
      const quote = priceBy.get(p.id);
      const avail = availBy.get(p.id);
      const conv = conversions.get(p.id);
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        vendorName: p.vendorName,
        countryOfOrigin: p.countryOfOrigin,
        labels: p.labels.map((l) => l.id),
        unitPriceExclVat: quote?.found ? quote.priceExclVat : null,
        salesUnit: p.salesUnit,
        perSalesUnit: p.contentPerSalesUnit,
        quantity: conv?.quantity ?? Math.ceil(req.quantity),
        converted: req.unit ? (conv?.converted ?? false) : true,
        orderable: avail ? avail.orderable : null,
        salesBlock: avail?.salesBlock ?? false,
        availableDate: avail?.availableDate ?? null,
        availableQuantity: avail?.availableQuantity ?? null,
        deliveryReliability: p.deliveryReliability,
        co2PerKg: p.co2PerKg,
        nameMatch: req.q ? computeNameMatchScore(req.q, p.name) : 1,
        previouslyOrderedProduct: orderedIds.has(p.id),
        previouslyOrderedBrand: !!p.brand && orderedBrands.has(p.brand.toLowerCase()),
      };
    }),
    {
      requestedDate: date,
      preferredOriginCountries: rules.preferredOriginCountries,
      preferredVendors: rules.preferredVendors,
      preferredBrands: rules.preferredBrands,
    },
  );

  const productBy = new Map(candidates.map((p) => [p.id, p]));
  const toRanked = (r: (typeof ranked)[number]): RankedProduct => {
    const conv = conversions.get(r.id);
    return {
      product: productBy.get(r.id)!,
      tier: r.tier,
      score: r.score,
      quantity: r.quantity,
      salesUnit: r.salesUnit,
      conversion: conv
        ? { converted: conv.converted, note: conv.note }
        : { converted: false, note: "No packaging data for this product; quantity taken as sales units." },
      unitPriceExclVat: r.unitPriceExclVat!,
      lineTotalExclVat: r.lineTotalExclVat!,
      pricePerContent: r.pricePerContent,
      availableDate: r.availableDate,
      availableQuantity: r.availableQuantity,
      priceSnapshotId: priceBy.get(r.id)?.snapshotId ?? null,
      availabilitySnapshotId: availBy.get(r.id)?.snapshotId ?? null,
      reasons: r.reasons,
    };
  };
  const list = ranked.map(toRanked).slice(0, req.limit);
  return {
    date,
    source: prices?.source ?? availability?.source ?? "mock",
    best: list[0] ?? null,
    better: list[1] ?? null,
    good: list[2] ?? null,
    ranked: list,
    unavailable: unavailable.map((u) => ({ product: productBy.get(u.id)!, reason: u.reason })),
    excluded,
  };
}
