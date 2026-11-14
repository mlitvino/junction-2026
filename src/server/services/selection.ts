import "server-only";

import { asc, desc, eq, ilike, inArray, or } from "drizzle-orm";

import { isAgentTestMode, requireGeminiApiKey } from "@/server/agents/mode";
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
import {
  getAvailability,
  getPrices,
  getProductSummaries,
  getUnitFacts,
  searchProducts,
} from "@/server/services/catalog";
import { extractProductsFromPrompt } from "@/server/services/extract";
import {
  classifyStockStatus,
  resolveUnifiedCatalogRecord,
  todayIsoDate,
} from "@/server/services/inquiry";
import {
  inferDietaryAndAllergensFromProduct,
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
import { toSalesUnits } from "@/server/valio/units";
import { allergenCodes, allergenNames } from "@/shared/contracts/allergens";
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
  PreviousOrderRecord,
  RemovedCandidate,
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
}): PreparationStep {
  return {
    action: `agent.${params.eventType}`,
    summary: params.summary,
    details: params.details ?? {},
    actorType: params.actorType === "system" ? "system" : "agent",
  };
}

/** The organization's buyer rules, in the shape the candidate filter uses. */
export async function customerPreferencesFor(organizationId: string): Promise<CustomerPreferences> {
  const effective = (await getEffectiveFor(organizationId, "buyer")).values;
  return {
    dietaryRestrictions: effective.dietaryRestrictions,
    // Candidates are tagged with allergen names; preferences may hold names or GS1 codes.
    excludedAllergens: allergenNames([...allergenCodes(effective.excludedAllergens)]),
    nutrition: {},
  };
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

/**
 * Calculates similarity between requested productName and candidate product name in [0, 1].
 * Combines exact/substring checks with word-level overlap and prefix matching.
 */
export function computeNameMatchScore(requestedName: string, candidateName: string): number {
  const reqNorm = requestedName.trim().toLowerCase();
  const candNorm = candidateName.trim().toLowerCase();
  if (!reqNorm || !candNorm) return 0;
  if (reqNorm === candNorm) return 1;

  const tokenize = (s: string) =>
    s
      .replace(/[^a-z0-9äöå]+/gi, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  const reqTokens = tokenize(reqNorm);
  const candTokens = tokenize(candNorm);
  if (reqTokens.length === 0 || candTokens.length === 0) return 0;

  let matchedReqTokens = 0;
  for (const rt of reqTokens) {
    if (candTokens.includes(rt)) {
      matchedReqTokens += 1;
    } else if (candTokens.some((ct) => ct.startsWith(rt) || rt.startsWith(ct))) {
      matchedReqTokens += 0.75;
    }
  }

  const reqCoverage = matchedReqTokens / reqTokens.length;
  const candCoverage = matchedReqTokens / candTokens.length;
  const substringBonus = candNorm.includes(reqNorm) ? 0.2 : 0;

  const rawScore = reqCoverage * 0.7 + candCoverage * 0.2 + substringBonus;
  return Math.min(1, Math.round(rawScore * 1000) / 1000);
}

/**
 * Checks a candidate against customer preferences (Dietary restrictions, Allergens, Nutritions).
 * Returns an array of mismatch reasons (empty array = matches preferences).
 */
export function evaluateCustomerPreferences(
  candidate: Pick<UnifiedCatalogRecord, "dietaryTags" | "allergens" | "nutrition">,
  preferences: CustomerPreferences,
): string[] {
  const reasons: string[] = [];

  const candidateDietary = new Set(candidate.dietaryTags.map((t) => t.toLowerCase()));
  for (const reqDiet of preferences.dietaryRestrictions) {
    if (!candidateDietary.has(reqDiet.toLowerCase())) {
      reasons.push(`Missing required dietary restriction: ${reqDiet}`);
    }
  }

  const candidateAllergens = new Set(candidate.allergens.map((a) => a.toLowerCase()));
  for (const excluded of preferences.excludedAllergens) {
    if (candidateAllergens.has(excluded.toLowerCase())) {
      reasons.push(`Contains excluded allergen: ${excluded}`);
    }
  }

  const { nutrition: limits } = preferences;
  const { nutrition: actual } = candidate;
  // No nutrition data: no nutrition rule applies (missing data never excludes a product).
  if (!actual) return reasons;

  if (
    limits.maxCaloriesPer100g !== undefined &&
    actual.caloriesPer100g > limits.maxCaloriesPer100g
  ) {
    reasons.push(
      `Calories (${actual.caloriesPer100g} kcal/100g) exceed maximum (${limits.maxCaloriesPer100g} kcal/100g)`,
    );
  }
  if (limits.maxFatPer100g !== undefined && actual.fatPer100g > limits.maxFatPer100g) {
    reasons.push(
      `Fat (${actual.fatPer100g}g/100g) exceeds maximum (${limits.maxFatPer100g}g/100g)`,
    );
  }
  if (limits.maxSugarPer100g !== undefined && actual.sugarPer100g > limits.maxSugarPer100g) {
    reasons.push(
      `Sugar (${actual.sugarPer100g}g/100g) exceeds maximum (${limits.maxSugarPer100g}g/100g)`,
    );
  }
  if (limits.maxSaltPer100g !== undefined && actual.saltPer100g > limits.maxSaltPer100g) {
    reasons.push(
      `Salt (${actual.saltPer100g}g/100g) exceeds maximum (${limits.maxSaltPer100g}g/100g)`,
    );
  }
  if (limits.minProteinPer100g !== undefined && actual.proteinPer100g < limits.minProteinPer100g) {
    reasons.push(
      `Protein (${actual.proteinPer100g}g/100g) is below minimum (${limits.minProteinPer100g}g/100g)`,
    );
  }

  return reasons;
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

export async function getCandidatesByProductType(
  productType: string,
  deliveryDate: string,
): Promise<UnifiedCatalogRecord[]> {
  const typeNorm = productType.trim().toLowerCase();
  const dbCandidates: UnifiedCatalogRecord[] = [];

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const likePattern = `%${typeNorm.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await db
        .select({
          id: valioProduct.id,
          name: valioProduct.name,
          brand: valioProduct.brand,
          vendorName: valioProduct.vendorName,
          category: valioProduct.category,
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
        })
        .from(valioProduct)
        .where(
          or(
            ilike(valioProduct.category, likePattern),
            ilike(valioProduct.searchText, likePattern),
          ),
        )
        .orderBy(asc(valioProduct.name), asc(valioProduct.id))
        .limit(40);

      if (rows.length > 0) {
        const priceMap = new Map<string, { price: number; vat: number }>();
        const availMap = new Map<
          string,
          { available: number | null; model: "stock" | "terminal"; salesBlock: boolean }
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
            });
          }
        } catch {
          // Valio unavailable: candidates without a real price are skipped below.
        }

        for (const r of rows) {
          const { dietaryTags, allergens } = inferDietaryAndAllergensFromProduct(
            r.name,
            r.allergens,
          );
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
            deliveryReliability: r.deliveryReliability,
            co2PerKg: r.co2PerKg,
            dietaryTags,
            allergens,
            nutrition: null,
            substituteIds: [],
          });
        }
      }
    } catch {
      // Database unavailable or empty; fall back to mock catalog below.
    }
  }

  // Synthetic products only when there is no real catalog (dev without data), never mixed in.
  const useSynthetic = await syntheticCatalogEnabled();
  const matchingMocks = (useSynthetic ? MOCK_CATALOG_PRODUCTS : []).filter((p) => {
    const pt = p.productType.toLowerCase();
    const cat = p.category.toLowerCase();
    const nm = p.name.toLowerCase();
    return (
      pt.includes(typeNorm) ||
      typeNorm.includes(pt) ||
      cat.includes(typeNorm) ||
      nm.includes(typeNorm)
    );
  });

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
  /** Note stored on the proposal (defaults to the prompt). */
  note?: string;
};

/** Ranks products for every requested item and creates one proposal from the chosen lines. */
export async function createProposalFromItems(actor: Actor, input: SelectionInput): Promise<ProposalFromPromptResponse> {
  const { extractedItems, deliveryDate, autoResolvePartialStock } = input;
  const [preferences, previousOrders] = await Promise.all([
    customerPreferencesFor(actor.organizationId),
    loadHistoricalOrderRecords(actor.organizationId),
  ]);
  const orderId = "pending";
  const auditTrail: PreparationStep[] = [...(input.initialSteps ?? [])];
  const actorId = actor.userId;
  const actorName = actor.userName;
  const previousProductIds = new Set(previousOrders.map((o) => o.productId.toLowerCase()));
  const previousProductNames = new Set(
    previousOrders.map((o) => o.productName.trim().toLowerCase()),
  );
  const previousBrands = new Set(previousOrders.map((o) => o.brand.trim().toLowerCase()));
  const hasPreviousOrders = previousOrders.length > 0;

  const pipeline: ItemProcurementTrace[] = [];
  const draftSelections: Array<{
    selected: CandidateProduct;
    requestedProductName: string;
    quantity: number;
    unit: string;
  }> = [];

  for (const item of extractedItems) {
    // Step 2: Get list of products by [Product type]
    const rawByType = await getCandidatesByProductType(item.productType, deliveryDate);
    const { quantity, unit } = parseQuantityAndUnit(item.productQuantity, "KG");

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
          requestedQuantity: quantity,
          deliveryDate,
        });
      })
      .sort((a, b) => b.nameMatchScore - a.nameMatchScore || a.name.localeCompare(b.name));

    // Step 4: Remove entries that don't match Customer preferences
    const survivingCandidates: CandidateProduct[] = [];
    const removedByPreferences: RemovedCandidate[] = [];

    for (const candidate of scoredByName) {
      const reasons = evaluateCustomerPreferences(candidate, preferences);
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
        summary: `Filtered candidates for '${item.productName}' against dietary/allergen/nutrition preferences: ${survivingCandidates.length} compliant, ${removedByPreferences.length} excluded.`,
        details: {
          requestedName: item.productName,
          survivingCount: survivingCandidates.length,
          removedByPreferences,
        },
      }),
    );

    // Step 5: Sort by previous order history (product, then brand, then nameMatchScore)
    const sortedCandidates = [...survivingCandidates].sort((a, b) => {
      if (hasPreviousOrders) {
        if (a.previouslyOrderedProduct !== b.previouslyOrderedProduct) {
          return a.previouslyOrderedProduct ? -1 : 1;
        }
        if (a.previouslyOrderedBrand !== b.previouslyOrderedBrand) {
          return a.previouslyOrderedBrand ? -1 : 1;
        }
      }
      if (b.nameMatchScore !== a.nameMatchScore) {
        return b.nameMatchScore - a.nameMatchScore;
      }
      return a.name.localeCompare(b.name);
    });

    const selectedProduct = sortedCandidates[0] ?? null;
    const resolvedUnit = selectedProduct?.salesUnit || unit;

    auditTrail.push(
      makeAuditEvent({
        orderId,
        actorType: "agent",
        actorId,
        actorName,
        eventType: "candidates_ranked",
        summary: selectedProduct
          ? `Selected '${selectedProduct.name}' (${selectedProduct.id}) for '${item.productName}' (match score ${selectedProduct.nameMatchScore}, previous SKU=${selectedProduct.previouslyOrderedProduct}, previous brand=${selectedProduct.previouslyOrderedBrand}).`
          : `No compliant candidate remained for '${item.productName}'.`,
        details: {
          requestedName: item.productName,
          selectedProductId: selectedProduct?.id ?? null,
          topAlternatives: sortedCandidates.slice(1, 4).map((c) => ({
            id: c.id,
            name: c.name,
            unitPriceEur: c.unitPriceEur,
          })),
        },
      }),
    );

    pipeline.push({
      extractedItem: item,
      parsedQuantity: quantity,
      parsedUnit: resolvedUnit,
      matchedByTypeCount: rawByType.length,
      removedByPreferences,
      sortedCandidates,
      selectedProduct,
    });

    if (selectedProduct) {
      // Optional Feature #4 & #8: Partial availability & allergen-safe split fulfillment
      if (
        autoResolvePartialStock &&
        selectedProduct.availableQuantity !== null &&
        selectedProduct.availableQuantity !== undefined &&
        selectedProduct.availableQuantity < quantity &&
        sortedCandidates.length > 1
      ) {
        let remaining = quantity;
        const splitAllocations: Array<{ productId: string; name: string; allocated: number }> = [];

        for (const cand of sortedCandidates) {
          if (remaining <= 0) break;
          const cap =
            cand.availableQuantity === null || cand.availableQuantity === undefined
              ? remaining
              : Math.max(0, cand.availableQuantity);
          if (cap <= 0) continue;
          const allocated = roundCurrency(Math.min(remaining, cap));
          if (allocated <= 0) continue;

          draftSelections.push({
            selected: cand,
            requestedProductName: item.productName,
            quantity: allocated,
            unit: cand.salesUnit || resolvedUnit,
          });
          splitAllocations.push({
            productId: cand.id,
            name: cand.name,
            allocated,
          });
          remaining = roundCurrency(remaining - allocated);
        }

        if (splitAllocations.length === 0) {
          draftSelections.push({
            selected: selectedProduct,
            requestedProductName: item.productName,
            quantity,
            unit: resolvedUnit,
          });
        } else {
          if (remaining > 0) {
            // Attach any unfulfilled remainder onto the primary line so stock_shortfall guardrail triggers transparently
            const firstDraft = draftSelections[draftSelections.length - splitAllocations.length];
            if (firstDraft) {
              firstDraft.quantity = roundCurrency(firstDraft.quantity + remaining);
            }
          }
          auditTrail.push(
            makeAuditEvent({
              orderId,
              actorType: "agent",
              actorId,
              actorName,
              eventType: "partial_stock_split",
              summary: `Resolved insufficient stock on '${selectedProduct.name}' (requested ${quantity} ${resolvedUnit}, available ${selectedProduct.availableQuantity}) across ${splitAllocations.length} allergen-safe SKU(s): ${splitAllocations.map((a) => `${a.allocated} of ${a.productId}`).join(" + ")}.`,
              details: {
                requestedQuantity: quantity,
                splitAllocations,
                unfulfilledRemainder: remaining,
              },
            }),
          );
        }
      } else {
        draftSelections.push({
          selected: selectedProduct,
          requestedProductName: item.productName,
          quantity,
          unit: resolvedUnit,
        });
      }
    }
  }

  // Merge duplicate productIds in draftSelections before running inquiry
  const mergedDraftMap = new Map<
    string,
    {
      selected: CandidateProduct;
      requestedProductName: string;
      quantity: number;
      unit: string;
    }
  >();
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
  // Quantities are ordered in the product's sales unit; flag where the request used another unit.
  for (const trace of pipeline) {
    const unit = trace.selectedProduct?.salesUnit;
    if (unit && trace.parsedUnit && unit.toUpperCase() !== trace.parsedUnit.toUpperCase())
      warnings.push(
        `'${trace.extractedItem.productName}': requested in ${trace.parsedUnit}, ordered as ${trace.parsedQuantity} ${unit} (sales unit). Check the quantity.`,
      );
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
      lines: finalDrafts.map((d) => ({ productId: d.selected.id, quantity: d.quantity })),
      date: deliveryDate,
      note: (input.note ?? input.prompt ?? undefined)?.slice(0, 1000),
    },
    { source: input.source, selection, preparation: auditTrail },
  );
  return { proposal, selection, message: nextStepMessage(proposal) };
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
        details: { prompt: input.prompt, extractedItems: extraction.items },
      },
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
  const search = await searchProducts({ q: toTarget, limit: 5, offset: 0, sort: "name" });
  return search.items[0]?.id ?? null;
}

const badRequest = (message: string) => new PurchasingError(400, "INVALID_CHANGE", message);

/**
 * Applies changes to a proposal's lines and creates the revised proposal (the old one is
 * cancelled). Accepts structured changes and/or a natural-language `prompt`
 * ("change 469330 to 469386", "set 30 cases of milk", "remove the oat drink").
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
      parsed = parseOrderChangeDeterministically(input.prompt);
    } else {
      requireGeminiApiKey();
      const agent = process.env.DATABASE_URL ? getMastra().getAgentById("order-change-agent") : orderChangeAgent;
      const context = [
        `Current proposal lines: ${JSON.stringify(current.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unit: l.salesUnit })))}`,
        `Available candidate alternatives: ${JSON.stringify(pipeline.flatMap((t) => t.sortedCandidates.map((c) => ({ id: c.id, name: c.name }))))}`,
        `Customer change request: ${input.prompt}`,
      ].join("\n");
      const llm = await agent.generate(context, { structuredOutput: { schema: ParsedOrderChangeSchema } });
      parsed = ParsedOrderChangeSchema.parse(llm.object);
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

  const lines = current.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unit: l.salesUnit ?? "" }));
  const applied: string[] = [];
  const preferences = await customerPreferencesFor(actor.organizationId);
  for (const rep of replacements) {
    const idx = lines.findIndex((l) => l.productId === rep.fromProductId);
    if (idx === -1) throw badRequest(`Product ${rep.fromProductId} is not in the proposal.`);
    const record = await resolveUnifiedCatalogRecord(rep.toProductId, date);
    if (!record) throw badRequest(`Product ${rep.toProductId} has no price for ${date} or is not in the catalog.`);
    const violations = evaluateCustomerPreferences(record, preferences);
    if (violations.length) throw badRequest(`${record.name} (${record.id}) breaks the organization's rules: ${violations.join("; ")}.`);
    const old = lines[idx]!;
    const quantity = rep.quantity ?? old.quantity;
    lines[idx] = { productId: record.id, name: record.name, quantity, unit: record.salesUnit };
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
    const violations = evaluateCustomerPreferences(record, preferences);
    if (violations.length) throw badRequest(`${record.name} (${record.id}) breaks the organization's rules: ${violations.join("; ")}.`);
    const existing = lines.find((l) => l.productId === record.id);
    if (existing) existing.quantity = roundCurrency(existing.quantity + add.quantity);
    else lines.push({ productId: record.id, name: record.name, quantity: add.quantity, unit: record.salesUnit });
    applied.push(`Added ${add.quantity} ${record.salesUnit} of ${record.name} (${record.id}).`);
  }
  if (input.date && input.date !== current.pricingDate) applied.push(`Moved the delivery date from ${current.pricingDate} to ${input.date}.`);

  return reviseProposal(actor, proposalId, {
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    date,
    appliedChanges: applied,
  });
}

// ---------- Ranking (POST /api/products/rank) ----------

/**
 * Good / better / best for a need ("1000 L of lactose-free milk"): candidates from the catalog,
 * the organization's rules (excluded allergens, dietary tags, blocked vendors) applied, the amount
 * converted per product, live prices and availability for the date, then `rankCandidates`.
 */
export async function rankProducts(actor: Actor, req: RankProductsRequest): Promise<RankProductsResponse> {
  const date = req.date ?? todayIsoDate();
  const rules = (await getEffectiveFor(actor.organizationId, "buyer")).values;
  const found = req.productIds?.length
    ? await getProductSummaries(req.productIds)
    : (await searchProducts({ q: req.q, limit: 60, offset: 0, sort: "name" })).items;
  if (req.q && !req.productIds?.length) {
    // Most relevant first, and only real matches (the same gate as the agent's selection).
    const score = new Map(found.map((p) => [p.id, computeNameMatchScore(req.q!, p.name)]));
    const top = Math.max(0, ...score.values());
    found.sort((a, b) => score.get(b.id)! - score.get(a.id)!);
    found.splice(0, found.length, ...found.filter((p) => score.get(p.id)! >= Math.max(0.35, top * 0.7)));
  }

  const excluded: RankProductsResponse["excluded"] = [];
  const allowed: ProductSummary[] = [];
  const banned = allergenCodes(rules.excludedAllergens);
  const blocked = new Set(rules.blockedVendors);
  for (const p of found) {
    const reasons: string[] = [];
    const hits = p.allergens.filter((a) => banned.has(a.toUpperCase()));
    if (hits.length) reasons.push(`contains excluded allergens: ${allergenNames(hits).join(", ")}`);
    const missing = rules.dietaryRestrictions.filter((t) => !p.dietaryTags.includes(t.toLowerCase()));
    if (missing.length) reasons.push(`not declared ${missing.join(", ")}`);
    if (blocked.has(p.vendorName)) reasons.push(`vendor ${p.vendorName} is blocked`);
    if (reasons.length) excluded.push({ product: p, reasons });
    else allowed.push(p);
  }
  const candidates = allowed.slice(0, req.limit);
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
      reasons: r.reasons,
    };
  };
  const list = ranked.map(toRanked);
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
