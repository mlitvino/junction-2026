import "server-only";

import { randomUUID } from "node:crypto";

import { asc, desc, eq, ilike, or } from "drizzle-orm";

import { assertGeminiConfigured } from "@/server/agents/gemini";
import { orderChangeAgent, ParsedOrderChangeSchema } from "@/server/agents/order-change-agent";
import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { procurementAuditEvent, procurementOrder, valioProduct } from "@/server/db/schema";
import { getMastra } from "@/server/mastra";
import { getAvailability, getPrices } from "@/server/services/catalog";
import { extractProductsFromPrompt } from "@/server/services/extract";
import {
  DEFAULT_MOCK_BUDGET_EUR,
  DEFAULT_MOCK_PREFERENCES,
  evaluateOrderGuardrails,
  getProcurementContext,
  mergeGuardrails,
} from "@/server/services/guardrails";
import {
  classifyStockStatus,
  createPriceAvailabilityInquiry,
  resolveUnifiedCatalogRecord,
  searchCatalogProducts,
  todayIsoDate,
} from "@/server/services/inquiry";
import { replenishInventoryFromOrderLines } from "@/server/services/inventory";
import {
  hashSeed,
  inferDietaryAndAllergensFromProduct,
  inferSustainabilityCertificates,
  MOCK_CATALOG_PRODUCTS,
  normalizeAllergenList,
  roundCurrency,
  synthesizeNutritionFromSeed,
  type UnifiedCatalogRecord,
} from "@/server/services/mock-catalog";
import { getEffectiveFor } from "@/server/services/preferences";
import type { ExtractedProductItem } from "@/shared/contracts/extract";
import type { AgentGuardrails } from "@/shared/contracts/guardrails";
import type { SessionUser } from "@/shared/contracts/me";
import type { Preferences } from "@/shared/contracts/preferences";
import {
  type ApproveOrderRequest,
  type ApproveOrderResponse,
  type AuditActorType,
  type AuditEventType,
  type AuditTrailEvent,
  type BudgetComparison,
  type CandidateProduct,
  type CheckoutOrderRequest,
  type CheckoutOrderResponse,
  type CreatedOrder,
  type CreateOrderFromPromptRequest,
  type CreateOrderFromPromptResponse,
  type CustomerPreferences,
  type ItemProcurementTrace,
  type ModifyOrderRequest,
  type ModifyOrderResponse,
  type OrderApproval,
  type OrderAuditResponse,
  type OrderDetailResponse,
  OrderDetailResponseSchema,
  type OrderLineItem,
  type OrderListResponse,
  type OrderReceipt,
  type PreviousOrderRecord,
  type ReceiptLineItem,
  type RemovedCandidate,
  type SuggestedAlternative,
} from "@/shared/contracts/orders";

export { DEFAULT_MOCK_BUDGET_EUR, DEFAULT_MOCK_PREFERENCES };

export class OrderServiceError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "OrderServiceError";
    this.status = status;
  }
}

export const DEFAULT_MOCK_PREVIOUS_ORDERS: PreviousOrderRecord[] = [
  {
    orderId: "ORD-HIST-001",
    orderedAt: "2026-10-25T09:30:00.000Z",
    productId: "460101",
    productName: "Valio Oltermanni Creamy Cheese 1kg",
    brand: "Valio",
    quantity: 120,
  },
  {
    orderId: "ORD-HIST-002",
    orderedAt: "2026-11-01T14:15:00.000Z",
    productId: "460201",
    productName: "Valio Fresh Whole Milk 1L",
    brand: "Valio",
    quantity: 80,
  },
  {
    orderId: "ORD-HIST-003",
    orderedAt: "2026-11-05T11:00:00.000Z",
    productId: "460301",
    productName: "Arla Creamy Havarti Cheese 1kg",
    brand: "Arla",
    quantity: 50,
  },
];

// In-memory store used as graceful fallback when DATABASE_URL is unset or unreachable.
const fallbackOrdersStore = new Map<string, OrderDetailResponse>();

export function getCreatedOrders(): CreatedOrder[] {
  return [...fallbackOrdersStore.values()].map((r) => r.order);
}

// ---------- Helpers ----------

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
 * Checks how many organization layered preference criteria (`preferredOriginCountries`,
 * `preferredVendors`, `preferredBrands`) a candidate matches.
 */
export function countLayeredPreferenceMatches(
  candidate: {
    vendorName?: string | null;
    brand?: string | null;
    countryOfOrigin?: string | null;
  },
  layeredPrefs?: Preferences | null,
): { originMatch: boolean; vendorMatch: boolean; brandMatch: boolean; matchCount: number } {
  if (!layeredPrefs) {
    return { originMatch: false, vendorMatch: false, brandMatch: false, matchCount: 0 };
  }
  const originNorm = candidate.countryOfOrigin?.trim().toLowerCase();
  const originMatch = Boolean(
    originNorm &&
    layeredPrefs.preferredOriginCountries.some((c) => c.trim().toLowerCase() === originNorm),
  );
  const vendorNorm = candidate.vendorName?.trim().toLowerCase();
  const vendorMatch = Boolean(
    vendorNorm && layeredPrefs.preferredVendors.some((v) => v.trim().toLowerCase() === vendorNorm),
  );
  const brandNorm = candidate.brand?.trim().toLowerCase();
  const brandMatch = Boolean(
    brandNorm && layeredPrefs.preferredBrands.some((b) => b.trim().toLowerCase() === brandNorm),
  );
  const matchCount = (originMatch ? 1 : 0) + (vendorMatch ? 1 : 0) + (brandMatch ? 1 : 0);
  return { originMatch, vendorMatch, brandMatch, matchCount };
}

/**
 * Checks a candidate against customer preferences (Dietary restrictions, Allergens, Nutritions)
 * and optional 3-layer organization preferences (CO2, delivery reliability, blocked vendors, allergens).
 * Returns an array of mismatch reasons (empty array = matches preferences).
 */
export function evaluateCustomerPreferences(
  candidate: Pick<UnifiedCatalogRecord, "dietaryTags" | "allergens" | "nutrition"> & {
    vendorName?: string;
    countryOfOrigin?: string | null;
    co2PerKg?: number | null;
    deliveryReliability?: number | null;
  },
  preferences: CustomerPreferences,
  layeredPrefs?: Preferences | null,
): string[] {
  const reasons: string[] = [];

  const candidateDietary = new Set(candidate.dietaryTags.map((t) => t.toLowerCase()));
  for (const reqDiet of preferences.dietaryRestrictions) {
    if (!candidateDietary.has(reqDiet.toLowerCase())) {
      reasons.push(`Missing required dietary restriction: ${reqDiet}`);
    }
  }

  const excludedAllergens = [...preferences.excludedAllergens];
  if (layeredPrefs) {
    const seen = new Set(excludedAllergens.map((a) => a.trim().toLowerCase()));
    for (const norm of normalizeAllergenList(layeredPrefs.excludedAllergens)) {
      if (!seen.has(norm)) {
        seen.add(norm);
        excludedAllergens.push(norm);
      }
    }
  }

  const candidateAllergens = new Set(candidate.allergens.map((a) => a.toLowerCase()));
  for (const excluded of excludedAllergens) {
    if (candidateAllergens.has(excluded.toLowerCase())) {
      reasons.push(`Contains excluded allergen: ${excluded}`);
    }
  }

  const { nutrition: limits } = preferences;
  const { nutrition: actual } = candidate;

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

  if (layeredPrefs) {
    if (
      layeredPrefs.maxCo2PerKg !== null &&
      candidate.co2PerKg != null &&
      candidate.co2PerKg > layeredPrefs.maxCo2PerKg
    ) {
      reasons.push(
        `CO2 footprint (${candidate.co2PerKg} kg CO2e/kg) exceeds maximum (${layeredPrefs.maxCo2PerKg} kg CO2e/kg)`,
      );
    }

    if (
      layeredPrefs.minDeliveryReliability !== null &&
      candidate.deliveryReliability != null &&
      candidate.deliveryReliability < layeredPrefs.minDeliveryReliability
    ) {
      reasons.push(
        `Delivery reliability (${(candidate.deliveryReliability * 100).toFixed(1)}%) is below minimum (${(layeredPrefs.minDeliveryReliability * 100).toFixed(1)}%)`,
      );
    }

    if (layeredPrefs.blockedVendors.length > 0 && candidate.vendorName) {
      const vendorLower = candidate.vendorName.trim().toLowerCase();
      if (layeredPrefs.blockedVendors.some((v) => v.trim().toLowerCase() === vendorLower)) {
        reasons.push(`Vendor '${candidate.vendorName}' is blocked by organization preferences`);
      }
    }
  }

  return reasons;
}

export function makeAuditEvent(params: {
  orderId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  actorName?: string | null;
  eventType: AuditEventType;
  summary: string;
  details?: Record<string, unknown>;
}): AuditTrailEvent {
  return {
    id: `AUD-${randomUUID().slice(0, 8).toUpperCase()}`,
    orderId: params.orderId,
    timestamp: new Date().toISOString(),
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    actorName: params.actorName ?? null,
    eventType: params.eventType,
    summary: params.summary,
    details: params.details ?? {},
  };
}

function buildSuggestedAlternatives(
  lines: OrderLineItem[],
  pipeline: ItemProcurementTrace[],
): SuggestedAlternative[] {
  return lines.map((line) => {
    const matchingTrace = pipeline.find(
      (t) =>
        t.selectedProduct?.id === line.productId ||
        t.extractedItem.productName.toLowerCase() === line.requestedProductName.toLowerCase(),
    );
    const alternatives = (matchingTrace?.sortedCandidates ?? []).filter(
      (c) => c.id !== line.productId,
    );
    return {
      forProductId: line.productId,
      forProductName: line.productName,
      alternatives,
    };
  });
}

function buildCustomerReviewPrompt(
  order: Pick<
    CreatedOrder,
    "orderId" | "status" | "totalPriceEur" | "lines" | "guardrailEvaluation"
  >,
  alternatives: SuggestedAlternative[],
): string {
  if (order.status === "unfulfilled") {
    return "No products matched all customer dietary, allergen, and nutritional preferences. Adjust preferences or try another query.";
  }
  if (order.status === "checked_out") {
    return `Order ${order.orderId} has been checked out and confirmed with Valio Aimo.`;
  }
  if (order.status === "rejected") {
    return `Order ${order.orderId} was rejected by an approver.`;
  }

  const swapHint = alternatives.find((a) => a.alternatives.length > 0);
  const swapExample = swapHint
    ? ` You can also swap '${swapHint.forProductName}' (${swapHint.forProductId}) for '${swapHint.alternatives[0]!.name}' (${swapHint.alternatives[0]!.id}) via PATCH /api/orders/${order.orderId}.`
    : "";

  if (order.status === "pending_approval") {
    const reasons = order.guardrailEvaluation.violations.map((v) => v.message).join(" ");
    return `Order ${order.orderId} (${order.totalPriceEur.toFixed(2)} EUR) requires human approval: ${reasons} Approve or reject via POST /api/orders/${order.orderId}/approval.${swapExample}`;
  }

  return `Order ${order.orderId} (${order.totalPriceEur.toFixed(2)} EUR) is authorized and ready for checkout via POST /api/orders/${order.orderId}/checkout.${swapExample}`;
}

function computeBudgetComparison(budgetEur: number, totalPriceEur: number): BudgetComparison {
  const withinBudget = totalPriceEur <= budgetEur;
  return {
    budgetEur,
    totalPriceEur,
    currency: "EUR",
    withinBudget,
    remainingBudgetEur: roundCurrency(budgetEur - totalPriceEur),
    exceededByEur: withinBudget ? 0 : roundCurrency(totalPriceEur - budgetEur),
  };
}

// ---------- Persistence Helpers (Postgres + In-Memory Fallback) ----------

async function persistOrderRecord(
  record: OrderDetailResponse,
  newAuditEvents: AuditTrailEvent[],
): Promise<void> {
  fallbackOrdersStore.set(record.order.orderId, record);

  if (!process.env.DATABASE_URL) return;

  try {
    await ensureDatabase();
    const db = getDb();
    const now = new Date(record.order.updatedAt);
    const created = new Date(record.order.createdAt);

    await db
      .insert(procurementOrder)
      .values({
        id: record.order.orderId,
        organizationId: record.order.organizationId,
        createdByUserId: record.order.createdByUserId,
        status: record.order.status,
        prompt: record.prompt,
        deliveryDate: record.order.deliveryDate,
        currency: record.order.currency,
        totalPriceEur: record.order.totalPriceEur,
        totalPriceInclVatEur: record.order.totalPriceInclVatEur,
        payload: record as unknown as Record<string, unknown>,
        createdAt: created,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: procurementOrder.id,
        set: {
          status: record.order.status,
          deliveryDate: record.order.deliveryDate,
          totalPriceEur: record.order.totalPriceEur,
          totalPriceInclVatEur: record.order.totalPriceInclVatEur,
          payload: record as unknown as Record<string, unknown>,
          updatedAt: now,
        },
      });

    if (newAuditEvents.length > 0) {
      await db
        .insert(procurementAuditEvent)
        .values(
          newAuditEvents.map((ev) => ({
            id: ev.id,
            orderId: ev.orderId,
            organizationId: record.order.organizationId,
            actorType: ev.actorType,
            actorId: ev.actorId,
            actorName: ev.actorName,
            eventType: ev.eventType,
            summary: ev.summary,
            details: ev.details,
            createdAt: new Date(ev.timestamp),
          })),
        )
        .onConflictDoNothing();
    }
  } catch {
    // Keep fallback in-memory record when Postgres is unreachable.
  }
}

async function loadOrderRecord(
  orderId: string,
  actor?: SessionUser | null,
): Promise<OrderDetailResponse> {
  let found: OrderDetailResponse | null = null;

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const [row] = await db
        .select()
        .from(procurementOrder)
        .where(eq(procurementOrder.id, orderId));

      if (row) {
        const parsed = OrderDetailResponseSchema.safeParse(row.payload);
        if (parsed.success) {
          found = parsed.data;
        }
      }
    } catch {
      // Fall back to in-memory store below.
    }
  }

  found ??= fallbackOrdersStore.get(orderId) ?? null;

  if (!found) {
    throw new OrderServiceError(`Order '${orderId}' not found.`, 404);
  }

  // Enforce organization boundary when signed in and the order belongs to an organization
  if (
    actor &&
    found.order.organizationId !== null &&
    found.order.organizationId !== actor.organization.id
  ) {
    throw new OrderServiceError(`Order '${orderId}' not found.`, 404);
  }

  return found;
}

export async function loadHistoricalOrderRecords(
  actor?: SessionUser | null,
): Promise<PreviousOrderRecord[]> {
  const historical: PreviousOrderRecord[] = [];

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const rows = actor
        ? await db
            .select()
            .from(procurementOrder)
            .where(eq(procurementOrder.organizationId, actor.organization.id))
            .orderBy(desc(procurementOrder.createdAt))
            .limit(20)
        : await db
            .select()
            .from(procurementOrder)
            .orderBy(desc(procurementOrder.createdAt))
            .limit(20);

      for (const row of rows) {
        if (
          row.status !== "confirmed" &&
          row.status !== "approved" &&
          row.status !== "checked_out"
        ) {
          continue;
        }
        const parsed = OrderDetailResponseSchema.safeParse(row.payload);
        if (!parsed.success) continue;
        for (const line of parsed.data.order.lines) {
          if (line.brand) {
            historical.push({
              orderId: parsed.data.order.orderId,
              orderedAt: parsed.data.order.createdAt,
              productId: line.productId,
              productName: line.productName,
              brand: line.brand,
              quantity: line.quantity,
            });
          }
        }
      }
    } catch {
      // Ignore DB lookup errors and fall back to defaults.
    }
  }

  for (const mem of fallbackOrdersStore.values()) {
    if (
      actor &&
      mem.order.organizationId !== null &&
      mem.order.organizationId !== actor.organization.id
    ) {
      continue;
    }
    if (
      mem.order.status === "confirmed" ||
      mem.order.status === "approved" ||
      mem.order.status === "checked_out"
    ) {
      for (const line of mem.order.lines) {
        if (
          line.brand &&
          !historical.some((h) => h.orderId === mem.order.orderId && h.productId === line.productId)
        ) {
          historical.push({
            orderId: mem.order.orderId,
            orderedAt: mem.order.createdAt,
            productId: line.productId,
            productName: line.productName,
            brand: line.brand,
            quantity: line.quantity,
          });
        }
      }
    }
  }

  return [...historical, ...DEFAULT_MOCK_PREVIOUS_ORDERS];
}

/** Fetch candidates matching `productType` from Postgres `valio_product` if available, plus mock catalog. */
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
          // Fallback to deterministic values if live Valio lookup fails
        }

        for (const r of rows) {
          const s = hashSeed(r.id);
          const { dietaryTags, allergens } = inferDietaryAndAllergensFromProduct(
            r.name,
            r.allergens,
          );
          const priceInfo = priceMap.get(r.id);
          const availInfo = availMap.get(r.id);

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
            unitPriceEur: priceInfo?.price ?? roundCurrency(2 + s * 12),
            vatRatePct: priceInfo?.vat ?? 14,
            availableQuantity: availInfo ? availInfo.available : Math.max(50, Math.floor(s * 600)),
            logisticModel: availInfo?.model ?? "stock",
            deliveryReliability: r.deliveryReliability,
            co2PerKg: r.co2PerKg,
            dietaryTags,
            allergens,
            nutrition: synthesizeNutritionFromSeed(r.id),
            substituteIds: [],
          });
        }
      }
    } catch {
      // Database unavailable or empty; fall back to mock catalog below.
    }
  }

  const matchingMocks = MOCK_CATALOG_PRODUCTS.filter((p) => {
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

  if (mergedById.size === 0) {
    return [...MOCK_CATALOG_PRODUCTS];
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
      inferSustainabilityCertificates(record.name, record.countryOfOrigin, record.brand),
    allergens: record.allergens,
    nutrition: record.nutrition,
    nameMatchScore,
    previouslyOrderedProduct,
    previouslyOrderedBrand,
  };
}

// ---------- Main Procurement Flow ----------

export async function executeCoreOrderCreation(params: {
  orderId?: string;
  prompt: string;
  extractedItems: ExtractedProductItem[];
  deliveryDate: string;
  preferences: CustomerPreferences;
  layeredPreferences?: Preferences | null;
  guardrails: AgentGuardrails;
  previousOrders: PreviousOrderRecord[];
  requireApproval?: boolean;
  autoResolvePartialStock?: boolean;
  initialAuditEvents?: AuditTrailEvent[];
  emptyOrderStatusOverride?: CreatedOrder["status"];
  emptyReviewPromptOverride?: string;
  actor?: SessionUser | null;
}): Promise<CreateOrderFromPromptResponse> {
  const {
    prompt,
    extractedItems,
    deliveryDate,
    preferences,
    layeredPreferences,
    guardrails,
    previousOrders,
    requireApproval,
    autoResolvePartialStock,
    emptyOrderStatusOverride,
    emptyReviewPromptOverride,
    actor,
  } = params;

  const orderId = params.orderId ?? `ORD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const auditTrail: AuditTrailEvent[] = [...(params.initialAuditEvents ?? [])];
  const actorType: AuditActorType = actor ? "buyer" : "agent";
  const actorId = actor?.id ?? null;
  const actorName = actor?.username ?? "Purchasing Agent";

  const previousProductIds = new Set(previousOrders.map((o) => o.productId.toLowerCase()));
  const previousProductNames = new Set(
    previousOrders.map((o) => o.productName.trim().toLowerCase()),
  );
  const previousBrands = new Set(previousOrders.map((o) => o.brand.trim().toLowerCase()));
  const hasPreviousOrders = previousOrders.length > 0;

  const pipeline: ItemProcurementTrace[] = [];
  let usedSubstitutes = false;
  const draftSelections: Array<{
    selected: CandidateProduct;
    requestedProductName: string;
    quantity: number;
    unit: string;
  }> = [];

  for (const item of extractedItems) {
    // Step 2: Get list of products by [Product type]
    const rawByType = await getCandidatesByProductType(item.productType, deliveryDate);
    const recordById = new Map<string, UnifiedCatalogRecord>(rawByType.map((r) => [r.id, r]));
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
      const rawRecord = recordById.get(candidate.id);
      const reasons = evaluateCustomerPreferences(
        { ...candidate, countryOfOrigin: rawRecord?.countryOfOrigin ?? null },
        preferences,
        layeredPreferences,
      );
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

    // Step 5: Sort by previous order history (product, then brand), org preference matches, then nameMatchScore
    const sortedCandidates = [...survivingCandidates].sort((a, b) => {
      if (hasPreviousOrders) {
        if (a.previouslyOrderedProduct !== b.previouslyOrderedProduct) {
          return a.previouslyOrderedProduct ? -1 : 1;
        }
        if (a.previouslyOrderedBrand !== b.previouslyOrderedBrand) {
          return a.previouslyOrderedBrand ? -1 : 1;
        }
      }
      if (layeredPreferences) {
        const aPref = countLayeredPreferenceMatches(
          {
            vendorName: a.vendorName,
            brand: a.brand,
            countryOfOrigin: recordById.get(a.id)?.countryOfOrigin ?? null,
          },
          layeredPreferences,
        ).matchCount;
        const bPref = countLayeredPreferenceMatches(
          {
            vendorName: b.vendorName,
            brand: b.brand,
            countryOfOrigin: recordById.get(b.id)?.countryOfOrigin ?? null,
          },
          layeredPreferences,
        ).matchCount;
        if (bPref !== aPref) {
          return bPref - aPref;
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
          if (
            splitAllocations.length > 1 ||
            (splitAllocations.length === 1 && splitAllocations[0]!.productId !== selectedProduct.id)
          ) {
            usedSubstitutes = true;
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

  // Core #5: Execute Price-and-Availability Inquiry before committing order lines
  const inquiry =
    finalDrafts.length > 0
      ? await createPriceAvailabilityInquiry({
          items: finalDrafts.map((d) => ({
            productId: d.selected.id,
            quantity: d.quantity,
          })),
          deliveryDate,
        })
      : null;

  const inquiryByProductId = new Map((inquiry?.lines ?? []).map((l) => [l.productId, l]));

  if (inquiry) {
    auditTrail.push(
      makeAuditEvent({
        orderId,
        actorType: "agent",
        actorId,
        actorName,
        eventType: "price_availability_inquired",
        summary: `Confirmed fixed-price & availability inquiry ${inquiry.inquiryId} for delivery ${inquiry.deliveryDate}: ${inquiry.totalExclVatEur.toFixed(2)} EUR excl. VAT (${inquiry.totalInclVatEur.toFixed(2)} EUR incl. VAT), allOrderable=${inquiry.allOrderable}.`,
        details: {
          inquiryId: inquiry.inquiryId,
          deliveryDate: inquiry.deliveryDate,
          validUntil: inquiry.validUntil,
          source: inquiry.source,
          lines: inquiry.lines,
        },
      }),
    );
  }

  const orderLines: OrderLineItem[] = finalDrafts.map(
    ({ selected, requestedProductName, quantity, unit }) => {
      const quote = inquiryByProductId.get(selected.id);
      const unitPriceEur = quote?.fixedUnitPriceExclVat ?? selected.unitPriceEur;
      const vatRatePct = quote?.vatRatePct ?? selected.vatRatePct ?? 14;
      const unitPriceInclVatEur =
        quote?.fixedUnitPriceInclVat ?? roundCurrency(unitPriceEur * (1 + vatRatePct / 100));
      const lineTotalEur = quote?.lineTotalExclVat ?? roundCurrency(unitPriceEur * quantity);
      const lineTotalInclVatEur =
        quote?.lineTotalInclVat ?? roundCurrency(lineTotalEur * (1 + vatRatePct / 100));

      return {
        productId: selected.id,
        productName: selected.name,
        brand: selected.brand,
        category: selected.category,
        productType: selected.productType,
        requestedProductName,
        quantity,
        unit: quote?.salesUnit || unit,
        unitPriceEur,
        unitPriceInclVatEur,
        vatRatePct,
        lineTotalEur,
        lineTotalInclVatEur,
        availableQuantity: quote ? quote.availableQuantity : (selected.availableQuantity ?? null),
        stockStatus: quote?.stockStatus ?? selected.stockStatus ?? "in_stock",
        earliestAvailableDate: quote?.earliestAvailableDate ?? deliveryDate,
        nameMatchScore: selected.nameMatchScore,
        previouslyOrderedProduct: selected.previouslyOrderedProduct,
        previouslyOrderedBrand: selected.previouslyOrderedBrand,
      };
    },
  );

  // Optional Feature #11: Automatic recurring-order anomaly audit check against historical baseline
  if (previousOrders.length > 0 && orderLines.length > 0) {
    const qtySpikes: Array<{
      productId: string;
      productName: string;
      historicalAvg: number;
      proposed: number;
      ratio: number;
    }> = [];

    for (const line of orderLines) {
      const matchingHist = previousOrders.filter(
        (h) => h.productId.toLowerCase() === line.productId.toLowerCase(),
      );
      if (matchingHist.length > 0) {
        const sortedQtys = matchingHist.map((h) => h.quantity).sort((a, b) => a - b);
        const mid = Math.floor(sortedQtys.length / 2);
        const baseline =
          sortedQtys.length % 2 === 1
            ? sortedQtys[mid]!
            : ((sortedQtys[mid - 1] ?? 0) + (sortedQtys[mid] ?? 0)) / 2;
        if (baseline > 0 && line.quantity / baseline >= 2.5) {
          qtySpikes.push({
            productId: line.productId,
            productName: line.productName,
            historicalAvg: roundCurrency(baseline),
            proposed: line.quantity,
            ratio: roundCurrency(line.quantity / baseline),
          });
        }
      }
    }

    if (qtySpikes.length > 0) {
      auditTrail.push(
        makeAuditEvent({
          orderId,
          actorType: "system",
          actorId: null,
          actorName: "Anomaly Detector",
          eventType: "recurring_anomaly_detected",
          summary: `Detected ${qtySpikes.length} recurring-order quantity spike(s) vs historical baseline: ${qtySpikes.map((s) => `${s.productName} (${s.proposed} vs avg ${s.historicalAvg}, ${s.ratio}x)`).join("; ")}.`,
          details: { qtySpikes },
        }),
      );
    }
  }

  // Step 6 & Core #9: Budget comparison & Agent permission guardrails
  const totalPriceEur = roundCurrency(orderLines.reduce((sum, l) => sum + l.lineTotalEur, 0));
  const totalPriceInclVatEur = roundCurrency(
    orderLines.reduce((sum, l) => sum + l.lineTotalInclVatEur, 0),
  );
  const budgetComparison = computeBudgetComparison(guardrails.budgetEur, totalPriceEur);
  const guardrailEvaluation = evaluateOrderGuardrails({
    lines: orderLines,
    totalPriceEur,
    guardrails,
    forceApproval: requireApproval,
    allowSubstitutes: layeredPreferences?.allowSubstitutes,
    usedSubstitutes,
  });

  auditTrail.push(
    makeAuditEvent({
      orderId,
      actorType: "system",
      actorId: null,
      actorName: "Guardrail Engine",
      eventType: "guardrails_evaluated",
      summary: guardrailEvaluation.authorizedForAutoConfirm
        ? `Guardrail check passed: ${totalPriceEur.toFixed(2)} EUR is within budget (${guardrails.budgetEur.toFixed(2)} EUR) and autonomous limit (${guardrails.autoApproveLimitEur.toFixed(2)} EUR).`
        : `Guardrail check paused order for human approval (${guardrailEvaluation.violations.length} rule(s) triggered): ${guardrailEvaluation.violations.map((v) => v.message).join(" ")}`,
      details: {
        budgetComparison,
        guardrailEvaluation,
      },
    }),
  );

  // Step 7: Create order
  const orderStatus: CreatedOrder["status"] =
    orderLines.length === 0
      ? (emptyOrderStatusOverride ?? "unfulfilled")
      : guardrailEvaluation.authorizedForAutoConfirm
        ? "confirmed"
        : "pending_approval";

  const approval: OrderApproval | null =
    orderStatus === "pending_approval"
      ? {
          status: "pending",
          requiredReasons: guardrailEvaluation.violations.map((v) => v.message),
          decidedAt: null,
          decidedByUserId: null,
          decidedByName: null,
          comment: null,
        }
      : null;

  const suggestedAlternatives = buildSuggestedAlternatives(orderLines, pipeline);
  const nowIso = new Date().toISOString();

  auditTrail.push(
    makeAuditEvent({
      orderId,
      actorType,
      actorId,
      actorName,
      eventType: orderStatus === "pending_approval" ? "approval_requested" : "order_created",
      summary:
        orderStatus === "pending_approval"
          ? `Created order ${orderId} in 'pending_approval' (${totalPriceEur.toFixed(2)} EUR) awaiting human approver sign-off or line item edits.`
          : orderStatus === "confirmed"
            ? orderLines.length === 0 && emptyReviewPromptOverride
              ? emptyReviewPromptOverride
              : `Created authorized order ${orderId} in 'confirmed' status (${totalPriceEur.toFixed(2)} EUR), ready for checkout.`
            : `Created order ${orderId} in 'unfulfilled' status (0 matching products).`,
      details: {
        status: orderStatus,
        lineCount: orderLines.length,
        totalPriceEur,
      },
    }),
  );

  const customerReviewPrompt =
    orderLines.length === 0 && emptyReviewPromptOverride
      ? emptyReviewPromptOverride
      : buildCustomerReviewPrompt(
          {
            orderId,
            status: orderStatus,
            totalPriceEur,
            lines: orderLines,
            guardrailEvaluation,
          },
          suggestedAlternatives,
        );

  const order: CreatedOrder = {
    orderId,
    organizationId: actor?.organization.id ?? null,
    createdByUserId: actor?.id ?? null,
    status: orderStatus,
    createdAt: nowIso,
    updatedAt: nowIso,
    deliveryDate,
    lines: orderLines,
    totalPriceEur,
    totalPriceInclVatEur,
    currency: "EUR",
    budgetComparison,
    guardrailsUsed: guardrails,
    guardrailEvaluation,
    inquiry,
    approval,
    receipt: null,
    customerReviewPrompt,
    auditTrail,
  };

  const response: CreateOrderFromPromptResponse = {
    prompt,
    extractedItems,
    preferencesUsed: preferences,
    previousOrdersUsed: previousOrders,
    pipeline,
    suggestedAlternatives,
    order,
  };

  await persistOrderRecord(response, auditTrail);
  return response;
}

/**
 * End-to-end procurement order creation pipeline from a user prompt (Steps 1–8):
 * 1. Extract structured items from the user prompt (`productName`, `productType`, `productQuantity`).
 * 2. Fetch candidate products by `[Product type]`.
 * 3. Score & sort candidates by best match on `[Product name]`.
 * 4. Remove entries that don't match customer preferences (Dietary restrictions, Allergens, Nutritions).
 * 5. Sort surviving candidates by previous order history (product, then brand, then nameMatchScore).
 * 6. Execute a Price-and-Availability Inquiry to confirm fixed prices & stock before commitment.
 * 7. Compare against budget & agent permission guardrails, build human-readable audit trail, and persist order.
 */
export async function createOrderFromPrompt(
  input: CreateOrderFromPromptRequest,
  actor?: SessionUser | null,
): Promise<CreateOrderFromPromptResponse> {
  const ctx = await getProcurementContext(actor, "buyer");
  const savedSettings = ctx.settings;
  const preferences: CustomerPreferences = input.preferences ?? savedSettings.preferences;
  const guardrails = mergeGuardrails(savedSettings.guardrails, input.guardrails, input.budgetEur);
  const deliveryDate = input.deliveryDate ?? todayIsoDate();
  const previousOrders: PreviousOrderRecord[] =
    input.previousOrders ?? (await loadHistoricalOrderRecords(actor));

  const orderId = `ORD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const actorId = actor?.id ?? null;
  const actorName = actor?.username ?? "Purchasing Agent";

  // Step 1: Extract structured product requests from user prompt
  const extraction = await extractProductsFromPrompt({ prompt: input.prompt });
  const extractedItems = extraction.items;

  const initialAuditEvents: AuditTrailEvent[] = [
    makeAuditEvent({
      orderId,
      actorType: "agent",
      actorId,
      actorName,
      eventType: "prompt_extracted",
      summary: `Extracted ${extractedItems.length} item(s) from buyer prompt: ${
        extractedItems.length > 0
          ? extractedItems
              .map((i) => `${i.productQuantity} of '${i.productName}' (${i.productType})`)
              .join("; ")
          : "none"
      }.`,
      details: { prompt: input.prompt, extractedItems },
    }),
  ];

  return executeCoreOrderCreation({
    orderId,
    prompt: input.prompt,
    extractedItems,
    deliveryDate,
    preferences,
    layeredPreferences: ctx.layered,
    guardrails,
    previousOrders,
    requireApproval: input.requireApproval,
    autoResolvePartialStock: input.autoResolvePartialStock,
    initialAuditEvents,
    actor,
  });
}

// ---------- Read Operations ----------

export async function listOrders(actor?: SessionUser | null): Promise<OrderListResponse> {
  const byId = new Map<string, CreatedOrder>();

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const rows = actor
        ? await db
            .select()
            .from(procurementOrder)
            .where(eq(procurementOrder.organizationId, actor.organization.id))
            .orderBy(desc(procurementOrder.createdAt))
            .limit(100)
        : await db
            .select()
            .from(procurementOrder)
            .orderBy(desc(procurementOrder.createdAt))
            .limit(100);

      for (const row of rows) {
        const parsed = OrderDetailResponseSchema.safeParse(row.payload);
        if (parsed.success) {
          byId.set(parsed.data.order.orderId, parsed.data.order);
        }
      }
    } catch {
      // Fall back to in-memory store below.
    }
  }

  for (const mem of fallbackOrdersStore.values()) {
    if (
      actor &&
      mem.order.organizationId !== null &&
      mem.order.organizationId !== actor.organization.id
    ) {
      continue;
    }
    if (!byId.has(mem.order.orderId)) {
      byId.set(mem.order.orderId, mem.order);
    }
  }

  const orders = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { orders };
}

export async function getOrderDetail(
  orderId: string,
  actor?: SessionUser | null,
): Promise<OrderDetailResponse> {
  return loadOrderRecord(orderId, actor);
}

export async function getOrderReceipt(
  orderId: string,
  actor?: SessionUser | null,
): Promise<OrderReceipt> {
  const record = await loadOrderRecord(orderId, actor);
  if (!record.order.receipt) {
    throw new OrderServiceError(
      `Order '${orderId}' has not been checked out yet (current status: ${record.order.status}).`,
      409,
    );
  }
  return record.order.receipt;
}

export async function getOrderAuditTrail(
  orderId: string,
  actor?: SessionUser | null,
): Promise<OrderAuditResponse> {
  const record = await loadOrderRecord(orderId, actor);
  return {
    orderId: record.order.orderId,
    status: record.order.status,
    auditTrail: record.order.auditTrail,
  };
}

// ---------- Step 8: Modify Order (Swap Product X -> Y, Update Quantities, Remove/Add) ----------

async function resolveLineTarget(
  target: string,
  lines: OrderLineItem[],
): Promise<OrderLineItem | null> {
  const norm = target.trim().toLowerCase();
  if (!norm || norm === "*") return lines[0] ?? null;

  const exactId = lines.find((l) => l.productId.toLowerCase() === norm);
  if (exactId) return exactId;

  let best: { line: OrderLineItem; score: number } | null = null;
  for (const line of lines) {
    const score = Math.max(
      computeNameMatchScore(target, line.productName),
      computeNameMatchScore(target, line.requestedProductName),
    );
    if (score > (best?.score ?? 0.25)) {
      best = { line, score };
    }
  }
  return best?.line ?? null;
}

async function resolveReplacementCatalogRecord(
  toTarget: string,
  pipeline: ItemProcurementTrace[],
  deliveryDate: string,
): Promise<UnifiedCatalogRecord | null> {
  const direct = await resolveUnifiedCatalogRecord(toTarget.trim(), deliveryDate);
  if (direct) return direct;

  // Search pipeline candidates first
  let bestCandidateId: string | null = null;
  let bestScore = 0.25;
  for (const trace of pipeline) {
    for (const cand of trace.sortedCandidates) {
      const score = computeNameMatchScore(toTarget, cand.name);
      if (score > bestScore) {
        bestScore = score;
        bestCandidateId = cand.id;
      }
    }
  }
  if (bestCandidateId) {
    const resolved = await resolveUnifiedCatalogRecord(bestCandidateId, deliveryDate);
    if (resolved) return resolved;
  }

  // Search broader catalog by name
  const search = await searchCatalogProducts({ q: toTarget, limit: 5, offset: 0 });
  if (search.items[0]) {
    return resolveUnifiedCatalogRecord(search.items[0].id, deliveryDate);
  }

  return null;
}

/**
 * Modifies an existing order (User Story Step 8: "change product X on product Y", update quantities,
 * add/remove lines). Supports both structured edits and free-form natural language prompts.
 */
export async function modifyOrder(
  orderId: string,
  input: ModifyOrderRequest,
  actor?: SessionUser | null,
): Promise<ModifyOrderResponse> {
  const existing = await loadOrderRecord(orderId, actor);

  if (existing.order.status === "checked_out") {
    throw new OrderServiceError(
      `Order '${orderId}' is already checked out and cannot be modified.`,
      409,
    );
  }
  if (existing.order.status === "rejected") {
    throw new OrderServiceError(`Order '${orderId}' was rejected and cannot be modified.`, 409);
  }

  const deliveryDate = input.deliveryDate ?? existing.order.deliveryDate;
  const workingLines = existing.order.lines.map((l) => ({ ...l }));
  const appliedChangesSummary: string[] = [];
  const preferenceOverrideReasons: string[] = [];

  const replacements = [...(input.replacements ?? [])];
  const quantityUpdates = [...(input.quantityUpdates ?? [])];
  const removeProductIds = [...(input.removeProductIds ?? [])];
  const addItems = [...(input.addItems ?? [])];

  // Parse optional natural-language prompt (e.g. "Change product 460101 on product 460301") via Gemini
  if (input.prompt) {
    assertGeminiConfigured();

    const agent = process.env.DATABASE_URL
      ? getMastra().getAgentById("order-change-agent")
      : orderChangeAgent;
    const contextPrompt = [
      `Current order lines: ${JSON.stringify(
        workingLines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          quantity: l.quantity,
          unit: l.unit,
        })),
      )}`,
      `Available candidate alternatives: ${JSON.stringify(
        existing.pipeline.flatMap((t) =>
          t.sortedCandidates.map((c) => ({ id: c.id, name: c.name })),
        ),
      )}`,
      `Customer change request: ${input.prompt}`,
    ].join("\n");

    const llmRes = await agent.generate(contextPrompt, {
      structuredOutput: { schema: ParsedOrderChangeSchema },
    });
    const parsedPromptChanges = ParsedOrderChangeSchema.parse(llmRes.object);

    for (const rep of parsedPromptChanges.replacements) {
      const matchedLine = await resolveLineTarget(rep.fromTarget, workingLines);
      if (!matchedLine) {
        throw new OrderServiceError(
          `Could not find product '${rep.fromTarget}' in order '${orderId}' to replace.`,
          400,
        );
      }
      const replacementRecord = await resolveReplacementCatalogRecord(
        rep.toTarget,
        existing.pipeline,
        deliveryDate,
      );
      if (!replacementRecord) {
        throw new OrderServiceError(
          `Replacement product '${rep.toTarget}' was not found in the Valio Aimo catalog.`,
          400,
        );
      }
      replacements.push({
        fromProductId: matchedLine.productId,
        toProductId: replacementRecord.id,
        quantity: rep.quantity,
      });
    }

    for (const qu of parsedPromptChanges.quantityUpdates) {
      const matchedLine = await resolveLineTarget(qu.target, workingLines);
      if (!matchedLine) {
        throw new OrderServiceError(
          `Could not find product '${qu.target}' in order '${orderId}' to update quantity.`,
          400,
        );
      }
      quantityUpdates.push({
        productId: matchedLine.productId,
        quantity: qu.quantity,
      });
    }

    for (const rem of parsedPromptChanges.removeTargets) {
      const matchedLine = await resolveLineTarget(rem, workingLines);
      if (matchedLine) {
        removeProductIds.push(matchedLine.productId);
      }
    }
  }

  if (
    replacements.length === 0 &&
    quantityUpdates.length === 0 &&
    removeProductIds.length === 0 &&
    addItems.length === 0 &&
    !input.deliveryDate
  ) {
    throw new OrderServiceError(
      "No valid order modifications were provided or recognized from the prompt.",
      400,
    );
  }

  const { layered: layeredPreferences } = await getProcurementContext(actor);
  const prevProductIds = new Set(existing.previousOrdersUsed.map((o) => o.productId.toLowerCase()));
  const prevBrands = new Set(existing.previousOrdersUsed.map((o) => o.brand.trim().toLowerCase()));

  // 1. Apply product X -> product Y replacements
  for (const rep of replacements) {
    const idx = workingLines.findIndex(
      (l) => l.productId.toLowerCase() === rep.fromProductId.toLowerCase(),
    );
    if (idx === -1) {
      throw new OrderServiceError(
        `Product '${rep.fromProductId}' is not present in order '${orderId}'.`,
        400,
      );
    }

    const targetRecord = await resolveUnifiedCatalogRecord(rep.toProductId, deliveryDate);
    if (!targetRecord) {
      throw new OrderServiceError(
        `Replacement product '${rep.toProductId}' does not exist in catalog.`,
        400,
      );
    }

    const prefViolations = evaluateCustomerPreferences(
      targetRecord,
      existing.preferencesUsed,
      layeredPreferences,
    );
    if (prefViolations.length > 0 && !input.allowPreferenceOverride) {
      throw new OrderServiceError(
        `Cannot replace with '${targetRecord.name}' (${targetRecord.id}) because it violates customer preferences: ${prefViolations.join("; ")}. Set allowPreferenceOverride=true to force with human approval.`,
        400,
      );
    }
    if (prefViolations.length > 0) {
      preferenceOverrideReasons.push(`${targetRecord.name}: ${prefViolations.join(", ")}`);
    }

    const oldLine = workingLines[idx]!;
    const nextQty = rep.quantity ?? oldLine.quantity;
    const vatRatePct = targetRecord.vatRatePct;
    const unitIncl = roundCurrency(targetRecord.unitPriceEur * (1 + vatRatePct / 100));

    workingLines[idx] = {
      productId: targetRecord.id,
      productName: targetRecord.name,
      brand: targetRecord.brand,
      category: targetRecord.category,
      productType: targetRecord.productType,
      requestedProductName: oldLine.requestedProductName,
      quantity: nextQty,
      unit: targetRecord.salesUnit,
      unitPriceEur: targetRecord.unitPriceEur,
      unitPriceInclVatEur: unitIncl,
      vatRatePct,
      lineTotalEur: roundCurrency(targetRecord.unitPriceEur * nextQty),
      lineTotalInclVatEur: roundCurrency(unitIncl * nextQty),
      availableQuantity: targetRecord.availableQuantity,
      stockStatus: "in_stock",
      earliestAvailableDate: deliveryDate,
      nameMatchScore: computeNameMatchScore(oldLine.requestedProductName, targetRecord.name),
      previouslyOrderedProduct: prevProductIds.has(targetRecord.id.toLowerCase()),
      previouslyOrderedBrand:
        targetRecord.brand !== null && prevBrands.has(targetRecord.brand.trim().toLowerCase()),
    };

    appliedChangesSummary.push(
      `Replaced '${oldLine.productName}' (${oldLine.productId}) with '${targetRecord.name}' (${targetRecord.id}) at quantity ${nextQty} ${targetRecord.salesUnit}.`,
    );
  }

  // 2. Apply quantity updates
  for (const qu of quantityUpdates) {
    const line = workingLines.find((l) => l.productId.toLowerCase() === qu.productId.toLowerCase());
    if (!line) {
      throw new OrderServiceError(
        `Product '${qu.productId}' is not present in order '${orderId}'.`,
        400,
      );
    }
    const prevQty = line.quantity;
    line.quantity = qu.quantity;
    appliedChangesSummary.push(
      `Updated quantity for '${line.productName}' (${line.productId}) from ${prevQty} to ${qu.quantity} ${line.unit}.`,
    );
  }

  // 3. Apply removals
  if (removeProductIds.length > 0) {
    const removeSet = new Set(removeProductIds.map((id) => id.toLowerCase()));
    for (let i = workingLines.length - 1; i >= 0; i -= 1) {
      const line = workingLines[i]!;
      if (removeSet.has(line.productId.toLowerCase())) {
        workingLines.splice(i, 1);
        appliedChangesSummary.push(
          `Removed '${line.productName}' (${line.productId}) from the order.`,
        );
      }
    }
  }

  // 4. Apply additions
  for (const add of addItems) {
    const record = await resolveUnifiedCatalogRecord(add.productId, deliveryDate);
    if (!record) {
      throw new OrderServiceError(`Product '${add.productId}' does not exist in catalog.`, 400);
    }
    const prefViolations = evaluateCustomerPreferences(
      record,
      existing.preferencesUsed,
      layeredPreferences,
    );
    if (prefViolations.length > 0 && !input.allowPreferenceOverride) {
      throw new OrderServiceError(
        `Cannot add '${record.name}' (${record.id}) because it violates customer preferences: ${prefViolations.join("; ")}.`,
        400,
      );
    }
    if (prefViolations.length > 0) {
      preferenceOverrideReasons.push(`${record.name}: ${prefViolations.join(", ")}`);
    }

    const existingLine = workingLines.find(
      (l) => l.productId.toLowerCase() === record.id.toLowerCase(),
    );
    if (existingLine) {
      existingLine.quantity = roundCurrency(existingLine.quantity + add.quantity);
      appliedChangesSummary.push(
        `Increased '${existingLine.productName}' (${existingLine.productId}) by ${add.quantity} to ${existingLine.quantity} ${existingLine.unit}.`,
      );
    } else {
      const unitIncl = roundCurrency(record.unitPriceEur * (1 + record.vatRatePct / 100));
      workingLines.push({
        productId: record.id,
        productName: record.name,
        brand: record.brand,
        category: record.category,
        productType: record.productType,
        requestedProductName: record.name,
        quantity: add.quantity,
        unit: record.salesUnit,
        unitPriceEur: record.unitPriceEur,
        unitPriceInclVatEur: unitIncl,
        vatRatePct: record.vatRatePct,
        lineTotalEur: roundCurrency(record.unitPriceEur * add.quantity),
        lineTotalInclVatEur: roundCurrency(unitIncl * add.quantity),
        availableQuantity: record.availableQuantity,
        stockStatus: "in_stock",
        earliestAvailableDate: deliveryDate,
        nameMatchScore: 1,
        previouslyOrderedProduct: prevProductIds.has(record.id.toLowerCase()),
        previouslyOrderedBrand:
          record.brand !== null && prevBrands.has(record.brand.trim().toLowerCase()),
      });
      appliedChangesSummary.push(
        `Added '${record.name}' (${record.id}), quantity ${add.quantity} ${record.salesUnit}.`,
      );
    }
  }

  if (input.deliveryDate && input.deliveryDate !== existing.order.deliveryDate) {
    appliedChangesSummary.push(
      `Updated requested delivery date from ${existing.order.deliveryDate} to ${input.deliveryDate}.`,
    );
  }

  // Re-run Price-and-Availability Inquiry on updated lines
  const inquiry =
    workingLines.length > 0
      ? await createPriceAvailabilityInquiry({
          items: workingLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          deliveryDate,
        })
      : null;

  const quoteById = new Map((inquiry?.lines ?? []).map((q) => [q.productId, q]));
  const refreshedLines: OrderLineItem[] = workingLines.map((line) => {
    const q = quoteById.get(line.productId);
    const unitPriceEur = q?.fixedUnitPriceExclVat ?? line.unitPriceEur;
    const vatRatePct = q?.vatRatePct ?? line.vatRatePct;
    const unitPriceInclVatEur =
      q?.fixedUnitPriceInclVat ?? roundCurrency(unitPriceEur * (1 + vatRatePct / 100));
    const lineTotalEur = q?.lineTotalExclVat ?? roundCurrency(unitPriceEur * line.quantity);
    const lineTotalInclVatEur =
      q?.lineTotalInclVat ?? roundCurrency(lineTotalEur * (1 + vatRatePct / 100));

    return {
      ...line,
      unit: q?.salesUnit || line.unit,
      unitPriceEur,
      unitPriceInclVatEur,
      vatRatePct,
      lineTotalEur,
      lineTotalInclVatEur,
      availableQuantity: q ? q.availableQuantity : line.availableQuantity,
      stockStatus: q?.stockStatus ?? line.stockStatus,
      earliestAvailableDate: q?.earliestAvailableDate ?? deliveryDate,
    };
  });

  const totalPriceEur = roundCurrency(refreshedLines.reduce((sum, l) => sum + l.lineTotalEur, 0));
  const totalPriceInclVatEur = roundCurrency(
    refreshedLines.reduce((sum, l) => sum + l.lineTotalInclVatEur, 0),
  );
  const guardrails = existing.order.guardrailsUsed;
  const budgetComparison = computeBudgetComparison(guardrails.budgetEur, totalPriceEur);
  const guardrailEvaluation = evaluateOrderGuardrails({
    lines: refreshedLines,
    totalPriceEur,
    guardrails,
    preferenceOverrideReasons,
  });

  const nextStatus: CreatedOrder["status"] =
    refreshedLines.length === 0
      ? "unfulfilled"
      : guardrailEvaluation.authorizedForAutoConfirm
        ? "confirmed"
        : "pending_approval";

  const nextApproval: OrderApproval | null =
    nextStatus === "pending_approval"
      ? {
          status: "pending",
          requiredReasons: guardrailEvaluation.violations.map((v) => v.message),
          decidedAt: null,
          decidedByUserId: null,
          decidedByName: null,
          comment: null,
        }
      : null;

  const suggestedAlternatives = buildSuggestedAlternatives(refreshedLines, existing.pipeline);
  const modifyEvent = makeAuditEvent({
    orderId,
    actorType: actor ? (actor.roles.includes("approver") ? "approver" : "buyer") : "buyer",
    actorId: actor?.id ?? null,
    actorName: actor?.username ?? "Customer",
    eventType: "order_modified",
    summary: `Modified order ${orderId}: ${appliedChangesSummary.join(" ")} Updated total: ${totalPriceEur.toFixed(2)} EUR (status: ${nextStatus}).`,
    details: {
      appliedChangesSummary,
      newInquiryId: inquiry?.inquiryId ?? null,
      totalPriceEur,
      status: nextStatus,
    },
  });

  const nowIso = new Date().toISOString();
  const updatedOrder: CreatedOrder = {
    ...existing.order,
    status: nextStatus,
    updatedAt: nowIso,
    deliveryDate,
    lines: refreshedLines,
    totalPriceEur,
    totalPriceInclVatEur,
    budgetComparison,
    guardrailEvaluation,
    inquiry,
    approval: nextApproval,
    customerReviewPrompt: buildCustomerReviewPrompt(
      {
        orderId,
        status: nextStatus,
        totalPriceEur,
        lines: refreshedLines,
        guardrailEvaluation,
      },
      suggestedAlternatives,
    ),
    auditTrail: [...existing.order.auditTrail, modifyEvent],
  };

  const updatedRecord: OrderDetailResponse = {
    ...existing,
    suggestedAlternatives,
    order: updatedOrder,
  };

  await persistOrderRecord(updatedRecord, [modifyEvent]);

  return {
    appliedChangesSummary,
    suggestedAlternatives,
    order: updatedOrder,
  };
}

// ---------- Core #10: Human Approval Workflow ----------

/**
 * Approves or rejects an order (Core Feature #10).
 * When signed in, requires the `approver` role within the organization.
 */
export async function decideOrderApproval(
  orderId: string,
  input: ApproveOrderRequest,
  actor?: SessionUser | null,
): Promise<ApproveOrderResponse> {
  if (actor && !actor.roles.includes("approver")) {
    throw new OrderServiceError(
      "Forbidden: only an organization approver can approve or reject orders.",
      403,
    );
  }

  const existing = await loadOrderRecord(orderId, actor);

  if (existing.order.status === "checked_out") {
    throw new OrderServiceError(`Order '${orderId}' has already been checked out.`, 409);
  }
  if (existing.order.status === "unfulfilled") {
    throw new OrderServiceError(
      `Order '${orderId}' has no fulfillable items and cannot be approved.`,
      409,
    );
  }

  if (actor && input.decision === "approve" && process.env.DATABASE_URL) {
    try {
      const effective = await getEffectiveFor(actor.organization.id, "approver");
      if (
        effective.values.maxOrderValue !== null &&
        existing.order.totalPriceEur > effective.values.maxOrderValue
      ) {
        throw new OrderServiceError(
          `Order total (${existing.order.totalPriceEur.toFixed(2)} EUR) exceeds approver maxOrderValue (${effective.values.maxOrderValue.toFixed(2)} EUR).`,
          403,
        );
      }
    } catch (err) {
      if (err instanceof OrderServiceError) throw err;
      // Ignore DB reachability errors when loading approver preferences.
    }
  }

  const nowIso = new Date().toISOString();
  const approverName = actor?.username ?? input.approverName ?? "Human Approver";
  const approved = input.decision === "approve";
  const nextStatus: CreatedOrder["status"] = approved ? "approved" : "rejected";

  const nextApproval: OrderApproval = {
    status: approved ? "approved" : "rejected",
    requiredReasons:
      existing.order.approval?.requiredReasons ??
      existing.order.guardrailEvaluation.violations.map((v) => v.message),
    decidedAt: nowIso,
    decidedByUserId: actor?.id ?? null,
    decidedByName: approverName,
    comment: input.comment ?? null,
  };

  const auditEvent = makeAuditEvent({
    orderId,
    actorType: "approver",
    actorId: actor?.id ?? null,
    actorName: approverName,
    eventType: approved ? "order_approved" : "order_rejected",
    summary: approved
      ? `Order ${orderId} (${existing.order.totalPriceEur.toFixed(2)} EUR) was approved by ${approverName}${input.comment ? ` ("${input.comment}")` : ""}. Ready for checkout.`
      : `Order ${orderId} was rejected by ${approverName}${input.comment ? ` ("${input.comment}")` : ""}.`,
    details: {
      decision: input.decision,
      comment: input.comment ?? null,
      totalPriceEur: existing.order.totalPriceEur,
    },
  });

  const updatedOrder: CreatedOrder = {
    ...existing.order,
    status: nextStatus,
    updatedAt: nowIso,
    approval: nextApproval,
    customerReviewPrompt: buildCustomerReviewPrompt(
      {
        orderId,
        status: nextStatus,
        totalPriceEur: existing.order.totalPriceEur,
        lines: existing.order.lines,
        guardrailEvaluation: existing.order.guardrailEvaluation,
      },
      existing.suggestedAlternatives,
    ),
    auditTrail: [...existing.order.auditTrail, auditEvent],
  };

  const updatedRecord: OrderDetailResponse = {
    ...existing,
    order: updatedOrder,
  };

  await persistOrderRecord(updatedRecord, [auditEvent]);
  return { order: updatedOrder };
}

// ---------- Step 9 & Core #8: Checkout Order & Issue Receipt ----------

/**
 * Submits an authorized (`confirmed` or `approved`) order to the Valio Aimo mock backend,
 * locks the fixed-price inquiry quote, transitions to `checked_out`, and issues a receipt.
 */
export async function checkoutOrder(
  orderId: string,
  input: CheckoutOrderRequest,
  actor?: SessionUser | null,
): Promise<CheckoutOrderResponse> {
  const existing = await loadOrderRecord(orderId, actor);

  if (existing.order.status === "checked_out" && existing.order.receipt) {
    return { order: existing.order, receipt: existing.order.receipt };
  }
  if (existing.order.status === "pending_approval") {
    throw new OrderServiceError(
      `Order '${orderId}' is pending human approval and cannot be checked out yet. Submit approval via POST /api/orders/${orderId}/approval first.`,
      409,
    );
  }
  if (existing.order.status === "rejected") {
    throw new OrderServiceError(`Order '${orderId}' was rejected and cannot be checked out.`, 409);
  }
  if (existing.order.status === "unfulfilled" || existing.order.lines.length === 0) {
    throw new OrderServiceError(`Order '${orderId}' has no fulfillable lines to check out.`, 409);
  }

  // Re-verify inquiry if expired so checkout always honors a valid fixed-price quote
  let activeInquiry = existing.order.inquiry;
  const now = new Date();
  if (!activeInquiry || new Date(activeInquiry.validUntil).getTime() < now.getTime()) {
    activeInquiry = await createPriceAvailabilityInquiry({
      items: existing.order.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
      })),
      deliveryDate: existing.order.deliveryDate,
    });
  }

  const receiptLines: ReceiptLineItem[] = existing.order.lines.map((line) => {
    const lineVatAmount = roundCurrency(line.lineTotalInclVatEur - line.lineTotalEur);
    return {
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      unit: line.unit,
      fixedUnitPriceExclVat: line.unitPriceEur,
      vatRatePct: line.vatRatePct,
      lineTotalExclVat: line.lineTotalEur,
      lineVatAmount,
      lineTotalInclVat: line.lineTotalInclVatEur,
      stockStatus: line.stockStatus,
    };
  });

  const subtotalExclVatEur = roundCurrency(
    receiptLines.reduce((sum, l) => sum + l.lineTotalExclVat, 0),
  );
  const totalInclVatEur = roundCurrency(
    receiptLines.reduce((sum, l) => sum + l.lineTotalInclVat, 0),
  );
  const totalVatEur = roundCurrency(totalInclVatEur - subtotalExclVatEur);
  const nowIso = now.toISOString();
  const dateCompact = nowIso.slice(0, 10).replace(/-/g, "");

  const authorizationSummary =
    existing.order.approval?.status === "approved"
      ? `Approved by human approver ${existing.order.approval.decidedByName ?? "Approver"} at ${existing.order.approval.decidedAt}.`
      : `Authorized autonomously within agent spending limit (${existing.order.guardrailsUsed.autoApproveLimitEur.toFixed(2)} EUR).`;

  const receipt: OrderReceipt = {
    receiptId: `RCP-${dateCompact}-${randomUUID().slice(0, 6).toUpperCase()}`,
    orderId,
    supplierConfirmationId: `VALIO-CONF-${randomUUID().slice(0, 6).toUpperCase()}`,
    issuedAt: nowIso,
    inquiryId: activeInquiry.inquiryId,
    deliveryDate: existing.order.deliveryDate,
    buyerOrganizationId: existing.order.organizationId ?? actor?.organization.id ?? null,
    checkedOutByName: actor?.username ?? "Purchasing Agent",
    customerReference: input.customerReference ?? null,
    deliveryNotes: input.deliveryNotes ?? null,
    authorizationSummary,
    paymentTerms: "Net 14 days (Valio Aimo B2B Fixed-Price Quote)",
    currency: "EUR",
    subtotalExclVatEur,
    totalVatEur,
    totalInclVatEur,
    lines: receiptLines,
  };

  const checkoutEvent = makeAuditEvent({
    orderId,
    actorType: actor ? "buyer" : "agent",
    actorId: actor?.id ?? null,
    actorName: actor?.username ?? "Purchasing Agent",
    eventType: "order_checked_out",
    summary: `Checked out order ${orderId} with Valio Aimo (confirmation ${receipt.supplierConfirmationId}, receipt ${receipt.receiptId}): ${receipt.subtotalExclVatEur.toFixed(2)} EUR excl. VAT (${receipt.totalInclVatEur.toFixed(2)} EUR incl. VAT) for delivery on ${receipt.deliveryDate}.`,
    details: {
      receiptId: receipt.receiptId,
      supplierConfirmationId: receipt.supplierConfirmationId,
      inquiryId: receipt.inquiryId,
      subtotalExclVatEur: receipt.subtotalExclVatEur,
      totalInclVatEur: receipt.totalInclVatEur,
    },
  });

  const updatedOrder: CreatedOrder = {
    ...existing.order,
    status: "checked_out",
    updatedAt: nowIso,
    inquiry: activeInquiry,
    receipt,
    customerReviewPrompt: `Order ${orderId} has been checked out. Receipt ${receipt.receiptId} (Valio confirmation ${receipt.supplierConfirmationId}).`,
    auditTrail: [...existing.order.auditTrail, checkoutEvent],
  };

  const updatedRecord: OrderDetailResponse = {
    ...existing,
    order: updatedOrder,
  };

  if (input.replenishInventory) {
    await replenishInventoryFromOrderLines(existing.order.lines, actor);
  }

  await persistOrderRecord(updatedRecord, [checkoutEvent]);
  return { order: updatedOrder, receipt };
}
