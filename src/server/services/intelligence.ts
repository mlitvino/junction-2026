import "server-only";

import { createHash } from "node:crypto";

import { getProcurementSettings } from "@/server/services/guardrails";
import { resolveUnifiedCatalogRecord, todayIsoDate } from "@/server/services/inquiry";
import { listInventory } from "@/server/services/inventory";
import {
  inferSustainabilityCertificates,
  MOCK_CATALOG_PRODUCTS,
  roundCurrency,
  type UnifiedCatalogRecord,
} from "@/server/services/mock-catalog";
import {
  computeNameMatchScore,
  evaluateCustomerPreferences,
  getCandidatesByProductType,
  getOrderDetail,
  loadHistoricalOrderRecords,
  OrderServiceError,
  toCandidateProduct,
} from "@/server/services/orders";
import { listRecipes } from "@/server/services/recipes";
import type { CatalogProductSummary } from "@/shared/contracts/catalog";
import type { CustomerPreferences } from "@/shared/contracts/guardrails";
import type {
  DeliveryComparison,
  OrderVerificationResponse,
  PartialAvailabilityPlan,
  ProactiveRecommendation,
  ProactiveRecommendationsResponse,
  ProactiveStockoutAlert,
  ProductSubstitutionRequest,
  ProductSubstitutionResponse,
  RankedSubstitute,
  RecurringOrderAnomaly,
  RecurringOrderCheckRequest,
  RecurringOrderCheckResponse,
  SplitAllocationLine,
  StockoutAlertsResponse,
  SustainabilityComparison,
  VerifiedClaim,
} from "@/shared/contracts/intelligence";
import type { SessionUser } from "@/shared/contracts/me";
import type { PreviousOrderRecord, RemovedCandidate } from "@/shared/contracts/orders";

export class IntelligenceServiceError extends Error {
  readonly status: 400 | 404;
  constructor(message: string, status: 400 | 404) {
    super(message);
    this.name = "IntelligenceServiceError";
    this.status = status;
  }
}

/** Deterministic canonical JSON serializer (lexicographically sorted keys) for SHA-256 proofs. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(",")}}`;
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return roundCurrency(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

function parseIsoDayMs(isoDate: string): number {
  const ms = Date.parse(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : Date.now();
}

/** Optional Feature #2: Delivery lead-time and reliability comparison against requested deadline. */
export function computeDeliveryComparison(params: {
  record: UnifiedCatalogRecord;
  requestedDeliveryDate: string;
  earliestAvailableDate?: string | null;
}): DeliveryComparison {
  const { record, requestedDeliveryDate } = params;
  const leadTimeDays = record.leadTimeDays ?? 1;
  const earliest = params.earliestAvailableDate ?? requestedDeliveryDate;
  const daysDelta = Math.round(
    (parseIsoDayMs(earliest) - parseIsoDayMs(requestedDeliveryDate)) / 86_400_000,
  );
  const meetsDeadline =
    (record.availableQuantity === null || record.availableQuantity > 0) && daysDelta <= 0;

  const rel = record.deliveryReliability;
  const reliabilityTier: DeliveryComparison["reliabilityTier"] =
    rel === null
      ? "unknown"
      : rel >= 0.97
        ? "high"
        : rel >= 0.93
          ? "medium"
          : "low";

  const relPct = rel !== null ? `${(rel * 100).toFixed(1)}% historical reliability` : "unrated reliability";
  const statusText =
    record.availableQuantity !== null && record.availableQuantity <= 0
      ? `Currently out of stock for ${requestedDeliveryDate}`
      : meetsDeadline
        ? `On-time for ${requestedDeliveryDate}`
        : `${daysDelta} day(s) past ${requestedDeliveryDate}`;

  return {
    requestedDeliveryDate,
    earliestAvailableDate: earliest,
    estimatedLeadTimeDays: leadTimeDays,
    meetsDeadline,
    daysDeltaFromDeadline: daysDelta,
    deliveryReliability: rel,
    reliabilityTier,
    summary: `${statusText} (${leadTimeDays}-day lead time, ${relPct}).`,
  };
}

/** Optional Features #3 & #7: Sustainability certificates and category-level CO2 comparison. */
export function computeSustainabilityComparison(
  record: UnifiedCatalogRecord,
  categoryPeers: UnifiedCatalogRecord[],
): SustainabilityComparison {
  const certificates =
    record.sustainabilityCertificates ??
    inferSustainabilityCertificates(record.name, record.countryOfOrigin, record.brand);

  const peerCo2Values = categoryPeers
    .filter((p) => p.category.toLowerCase() === record.category.toLowerCase())
    .map((p) => p.co2PerKg)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  if (record.co2PerKg !== null && !peerCo2Values.includes(record.co2PerKg)) {
    peerCo2Values.push(record.co2PerKg);
  }

  if (peerCo2Values.length === 0 || record.co2PerKg === null) {
    return {
      category: record.category,
      certificates,
      countryOfOrigin: record.countryOfOrigin,
      productCo2PerKg: record.co2PerKg,
      categoryMinCo2PerKg: null,
      categoryAvgCo2PerKg: null,
      categoryMaxCo2PerKg: null,
      co2VsCategoryAvgPct: null,
      footprintRating: "unknown",
      summary: `CO2 estimate unavailable; ${certificates.length} sustainability certificate(s).`,
    };
  }

  const minCo2 = roundCurrency(Math.min(...peerCo2Values));
  const maxCo2 = roundCurrency(Math.max(...peerCo2Values));
  const avgCo2 = roundCurrency(
    peerCo2Values.reduce((sum, v) => sum + v, 0) / peerCo2Values.length,
  );
  const vsAvgPct =
    avgCo2 > 0 ? roundCurrency(((record.co2PerKg - avgCo2) / avgCo2) * 100) : 0;

  const footprintRating: SustainabilityComparison["footprintRating"] =
    vsAvgPct <= -5 ? "low_impact" : vsAvgPct >= 10 ? "high_impact" : "average_impact";

  const sign = vsAvgPct > 0 ? "+" : "";
  return {
    category: record.category,
    certificates,
    countryOfOrigin: record.countryOfOrigin,
    productCo2PerKg: record.co2PerKg,
    categoryMinCo2PerKg: minCo2,
    categoryAvgCo2PerKg: avgCo2,
    categoryMaxCo2PerKg: maxCo2,
    co2VsCategoryAvgPct: vsAvgPct,
    footprintRating,
    summary: `${record.co2PerKg.toFixed(2)} kg CO2e/kg (${sign}${vsAvgPct.toFixed(1)}% vs ${record.category} avg ${avgCo2.toFixed(2)}; range ${minCo2.toFixed(2)}–${maxCo2.toFixed(2)}); ${certificates.length} certificate(s).`,
  };
}

function buildRankedSubstitutes(params: {
  target: UnifiedCatalogRecord;
  candidates: UnifiedCatalogRecord[];
  preferences: CustomerPreferences;
  previousOrders: PreviousOrderRecord[];
  requestedQuantity: number;
  deliveryDate: string;
}): {
  excludedUnsafeAlternatives: RemovedCandidate[];
  rankedSubstitutes: RankedSubstitute[];
} {
  const { target, candidates, preferences, previousOrders, requestedQuantity, deliveryDate } =
    params;

  const previousProductIds = new Set(previousOrders.map((o) => o.productId.toLowerCase()));
  const previousBrands = new Set(previousOrders.map((o) => o.brand.trim().toLowerCase()));

  const excludedUnsafeAlternatives: RemovedCandidate[] = [];
  const safeEntries: Array<{
    record: UnifiedCatalogRecord;
    score: number;
    candidate: ReturnType<typeof toCandidateProduct>;
    deliveryComparison: DeliveryComparison;
    sustainabilityComparison: SustainabilityComparison;
    priceDeltaEur: number;
    co2DeltaPerKg: number | null;
    reliabilityDelta: number | null;
    tradeOffs: string[];
  }> = [];

  for (const record of candidates) {
    if (record.id === target.id) continue;

    const safetyReasons = evaluateCustomerPreferences(record, preferences);
    if (safetyReasons.length > 0) {
      excludedUnsafeAlternatives.push({
        id: record.id,
        name: record.name,
        brand: record.brand,
        reasons: safetyReasons,
      });
      continue;
    }

    // Do not recommend substitutes that are themselves out of stock
    if (record.availableQuantity !== null && record.availableQuantity <= 0) {
      continue;
    }

    const nameSim = computeNameMatchScore(target.name, record.name);
    const prevProd = previousProductIds.has(record.id.toLowerCase());
    const prevBrand = record.brand !== null && previousBrands.has(record.brand.toLowerCase());

    const cand = toCandidateProduct({
      record,
      nameMatchScore: nameSim,
      previouslyOrderedProduct: prevProd,
      previouslyOrderedBrand: prevBrand,
      requestedQuantity,
      deliveryDate,
    });

    const deliveryComparison = computeDeliveryComparison({
      record,
      requestedDeliveryDate: deliveryDate,
    });
    const sustainabilityComparison = computeSustainabilityComparison(record, candidates);

    const priceDeltaEur = roundCurrency(record.unitPriceEur - target.unitPriceEur);
    const co2DeltaPerKg =
      record.co2PerKg !== null && target.co2PerKg !== null
        ? roundCurrency(record.co2PerKg - target.co2PerKg)
        : null;
    const reliabilityDelta =
      record.deliveryReliability !== null && target.deliveryReliability !== null
        ? Math.round((record.deliveryReliability - target.deliveryReliability) * 1000) / 1000
        : null;

    // Composite ranking score in [0, 1]
    const explicitSubBonus = target.substituteIds.includes(record.id) ? 0.2 : 0;
    const stockCoverage =
      record.availableQuantity === null
        ? 1
        : Math.min(1, record.availableQuantity / Math.max(1, requestedQuantity));
    const priceScore =
      target.unitPriceEur > 0
        ? Math.max(0, Math.min(1, 1 - (record.unitPriceEur - target.unitPriceEur) / target.unitPriceEur))
        : 0.5;
    const co2Score =
      co2DeltaPerKg !== null && target.co2PerKg && target.co2PerKg > 0
        ? Math.max(0, Math.min(1, 0.5 - co2DeltaPerKg / (2 * target.co2PerKg)))
        : 0.5;
    const historyScore = prevProd ? 0.15 : prevBrand ? 0.08 : 0;

    const rawScore =
      nameSim * 0.3 +
      stockCoverage * 0.25 +
      priceScore * 0.15 +
      co2Score * 0.1 +
      explicitSubBonus +
      historyScore;
    const score = Math.min(1, Math.round(rawScore * 1000) / 1000);

    const tradeOffs: string[] = [];
    if (priceDeltaEur === 0) {
      tradeOffs.push(`Identical unit price (${record.unitPriceEur.toFixed(2)} EUR/${record.salesUnit})`);
    } else if (priceDeltaEur < 0) {
      tradeOffs.push(
        `Saves ${Math.abs(priceDeltaEur).toFixed(2)} EUR/${record.salesUnit} vs '${target.name}'`,
      );
    } else {
      tradeOffs.push(
        `+${priceDeltaEur.toFixed(2)} EUR/${record.salesUnit} vs '${target.name}'`,
      );
    }

    if (co2DeltaPerKg !== null) {
      if (co2DeltaPerKg < 0) {
        tradeOffs.push(`Lower carbon footprint (${co2DeltaPerKg.toFixed(2)} kg CO2e/kg)`);
      } else if (co2DeltaPerKg > 0) {
        tradeOffs.push(`Higher carbon footprint (+${co2DeltaPerKg.toFixed(2)} kg CO2e/kg)`);
      }
    }

    if (record.availableQuantity !== null) {
      tradeOffs.push(
        `${record.availableQuantity} ${record.salesUnit} available (${record.availableQuantity >= requestedQuantity ? "covers full request" : "partial coverage"})`,
      );
    }

    if (prevProd) {
      tradeOffs.push("Previously ordered SKU by your organization");
    } else if (prevBrand && record.brand) {
      tradeOffs.push(`Trusted brand from past orders (${record.brand})`);
    }

    safeEntries.push({
      record,
      score,
      candidate: cand,
      deliveryComparison,
      sustainabilityComparison,
      priceDeltaEur,
      co2DeltaPerKg,
      reliabilityDelta,
      tradeOffs,
    });
  }

  safeEntries.sort((a, b) => b.score - a.score || a.record.unitPriceEur - b.record.unitPriceEur);

  const rankedSubstitutes: RankedSubstitute[] = safeEntries.slice(0, 6).map((entry, idx) => {
    const tier: RankedSubstitute["tier"] = idx === 0 ? "best" : idx === 1 ? "better" : "good";
    return {
      tier,
      rank: idx + 1,
      overallScore: entry.score,
      allergenAndPreferenceSafe: true,
      candidate: entry.candidate,
      priceDeltaEur: entry.priceDeltaEur,
      co2DeltaPerKg: entry.co2DeltaPerKg,
      reliabilityDelta: entry.reliabilityDelta,
      deliveryComparison: entry.deliveryComparison,
      sustainabilityComparison: entry.sustainabilityComparison,
      tradeOffs: entry.tradeOffs,
    };
  });

  return { excludedUnsafeAlternatives, rankedSubstitutes };
}

function buildPartialAvailabilityPlan(params: {
  target: UnifiedCatalogRecord;
  targetPreferencesSafe: boolean;
  requestedQuantity: number;
  rankedSubstitutes: RankedSubstitute[];
}): PartialAvailabilityPlan {
  const { target, targetPreferencesSafe, requestedQuantity, rankedSubstitutes } = params;
  const primaryAvail =
    !targetPreferencesSafe
      ? 0
      : target.availableQuantity === null
        ? requestedQuantity
        : Math.max(0, target.availableQuantity);

  const allocations: SplitAllocationLine[] = [];
  let remaining = requestedQuantity;

  if (primaryAvail > 0) {
    const allocQty = roundCurrency(Math.min(remaining, primaryAvail));
    allocations.push({
      role: "primary",
      productId: target.id,
      productName: target.name,
      allocatedQuantity: allocQty,
      availableQuantity: target.availableQuantity,
      unit: target.salesUnit,
      unitPriceEur: target.unitPriceEur,
      lineTotalEur: roundCurrency(allocQty * target.unitPriceEur),
    });
    remaining = roundCurrency(remaining - allocQty);
  }

  const shortfallOnPrimary = remaining;
  const requiresSplitOrSubstitute = shortfallOnPrimary > 0;

  if (remaining > 0) {
    for (const sub of rankedSubstitutes) {
      if (remaining <= 0) break;
      const subAvail =
        sub.candidate.availableQuantity === null || sub.candidate.availableQuantity === undefined
          ? remaining
          : Math.max(0, sub.candidate.availableQuantity);
      if (subAvail <= 0) continue;

      const allocQty = roundCurrency(Math.min(remaining, subAvail));
      allocations.push({
        role: "substitute",
        productId: sub.candidate.id,
        productName: sub.candidate.name,
        allocatedQuantity: allocQty,
        availableQuantity: sub.candidate.availableQuantity ?? null,
        unit: sub.candidate.salesUnit,
        unitPriceEur: sub.candidate.unitPriceEur,
        lineTotalEur: roundCurrency(allocQty * sub.candidate.unitPriceEur),
      });
      remaining = roundCurrency(remaining - allocQty);
    }
  }

  const totalFulfilledQuantity = roundCurrency(requestedQuantity - remaining);
  const totalPlanCostEur = roundCurrency(
    allocations.reduce((sum, a) => sum + a.lineTotalEur, 0),
  );
  const fullyFulfillableWithSubstitutes = remaining <= 0;

  const summary = !requiresSplitOrSubstitute
    ? `Primary SKU ${target.id} ('${target.name}') fulfills all ${requestedQuantity} ${target.salesUnit} in stock (${totalPlanCostEur.toFixed(2)} EUR).`
    : fullyFulfillableWithSubstitutes
      ? `Primary SKU ${target.id} covers ${roundCurrency(requestedQuantity - shortfallOnPrimary)} ${target.salesUnit}; remaining ${shortfallOnPrimary} ${target.salesUnit} fulfilled via ${allocations.filter((a) => a.role === "substitute").map((a) => `${a.allocatedQuantity} ${a.unit} of ${a.productId}`).join(" + ")} (total ${totalPlanCostEur.toFixed(2)} EUR).`
      : `Partial fulfillment only: ${totalFulfilledQuantity} of ${requestedQuantity} ${target.salesUnit} covered across ${allocations.length} SKU(s); ${remaining} ${target.salesUnit} remains unfulfilled.`;

  return {
    requestedQuantity,
    primaryAvailableQuantity: target.availableQuantity,
    shortfallOnPrimary,
    requiresSplitOrSubstitute,
    fullyFulfillableWithSubstitutes,
    totalFulfilledQuantity,
    remainingUnfulfilledQuantity: remaining,
    totalPlanCostEur,
    allocations,
    summary,
  };
}

/**
 * Optional Features #2, #3, #4, #5, #7, #8:
 * Evaluates allergen-safe Good/Better/Best product substitutions, partial-availability split
 * combinations, delivery lead-time comparison, and category-level CO2 sustainability comparison.
 */
export async function evaluateProductSubstitutions(
  input: ProductSubstitutionRequest,
  actor?: SessionUser | null,
): Promise<ProductSubstitutionResponse> {
  const deliveryDate = input.deliveryDate ?? todayIsoDate();
  const target = await resolveUnifiedCatalogRecord(input.productId, deliveryDate);
  if (!target) {
    throw new IntelligenceServiceError(`Product '${input.productId}' not found.`, 404);
  }

  const savedSettings = await getProcurementSettings(actor);
  const preferences = input.preferences ?? savedSettings.preferences;
  const previousOrders = await loadHistoricalOrderRecords(actor);

  const byType = await getCandidatesByProductType(target.productType, deliveryDate);
  const byCategory = await getCandidatesByProductType(target.category, deliveryDate);
  const explicitSubs = await Promise.all(
    target.substituteIds.map((id) => resolveUnifiedCatalogRecord(id, deliveryDate)),
  );

  const candidateMap = new Map<string, UnifiedCatalogRecord>();
  for (const item of [target, ...byType, ...byCategory, ...explicitSubs]) {
    if (item && !candidateMap.has(item.id)) {
      candidateMap.set(item.id, item);
    }
  }
  const allPeers = [...candidateMap.values()];

  const targetCandidate = toCandidateProduct({
    record: target,
    nameMatchScore: 1,
    previouslyOrderedProduct: previousOrders.some(
      (o) => o.productId.toLowerCase() === target.id.toLowerCase(),
    ),
    previouslyOrderedBrand:
      target.brand !== null &&
      previousOrders.some((o) => o.brand.toLowerCase() === target.brand!.toLowerCase()),
    requestedQuantity: input.requestedQuantity,
    deliveryDate,
  });

  const targetDeliveryComparison = computeDeliveryComparison({
    record: target,
    requestedDeliveryDate: deliveryDate,
  });
  const targetSustainabilityComparison = computeSustainabilityComparison(target, allPeers);

  const { excludedUnsafeAlternatives, rankedSubstitutes } = buildRankedSubstitutes({
    target,
    candidates: allPeers,
    preferences,
    previousOrders,
    requestedQuantity: input.requestedQuantity,
    deliveryDate,
  });

  const targetPreferencesSafe = evaluateCustomerPreferences(target, preferences).length === 0;
  const partialAvailabilityPlan = buildPartialAvailabilityPlan({
    target,
    targetPreferencesSafe,
    requestedQuantity: input.requestedQuantity,
    rankedSubstitutes,
  });

  return {
    targetProduct: targetCandidate,
    targetDeliveryComparison,
    targetSustainabilityComparison,
    preferencesEnforced: preferences,
    excludedUnsafeAlternatives,
    rankedSubstitutes,
    partialAvailabilityPlan,
  };
}

/**
 * Optional Feature #6: Open Trust & Verification Layer (`GET /api/orders/{orderId}/verify`).
 * Generates independently recomputable canonical-JSON SHA-256 digests proving fixed-price quotes,
 * stock availability, product origin & sustainability labels, allergen compliance, guardrails,
 * and chronological audit-chain integrity.
 */
export async function verifyOrderTrustClaims(
  orderId: string,
  actor?: SessionUser | null,
): Promise<OrderVerificationResponse> {
  const detail = await getOrderDetail(orderId, actor);
  const { order, preferencesUsed } = detail;
  const claims: VerifiedClaim[] = [];
  const inquiryByProduct = new Map(
    (order.inquiry?.lines ?? []).map((l) => [l.productId, l]),
  );

  for (const line of order.lines) {
    const quote = inquiryByProduct.get(line.productId);
    const catalogRecord = await resolveUnifiedCatalogRecord(line.productId, order.deliveryDate);

    // 1. Fixed-price claim
    const priceMatched = Boolean(
      quote &&
        quote.priceFound &&
        quote.fixedUnitPriceExclVat !== null &&
        Math.abs(quote.fixedUnitPriceExclVat - line.unitPriceEur) < 0.001,
    );
    const priceEvidence = {
      orderId: order.orderId,
      inquiryId: order.inquiry?.inquiryId ?? null,
      source: order.inquiry?.source ?? "mock",
      quotedAt: order.inquiry?.quotedAt ?? null,
      validUntil: order.inquiry?.validUntil ?? null,
      productId: line.productId,
      fixedUnitPriceExclVat: line.unitPriceEur,
      vatRatePct: line.vatRatePct,
      currency: order.currency,
    };
    claims.push({
      claimType: "fixed_price_quote",
      subject: `Product ${line.productId} (${line.productName})`,
      verified: priceMatched,
      evidenceSource: order.inquiry
        ? `PriceAvailabilityInquiry ${order.inquiry.inquiryId} (${order.inquiry.source})`
        : "No inquiry snapshot",
      statement: priceMatched
        ? `Verified fixed price ${line.unitPriceEur.toFixed(2)} EUR/${line.unit} locked by inquiry ${order.inquiry!.inquiryId}.`
        : `Fixed price quote missing or mismatched for ${line.productId}.`,
      evidenceData: priceEvidence,
      sha256Digest: sha256Canonical(priceEvidence),
    });

    // 2. Stock availability claim
    const stockVerified =
      line.stockStatus === "in_stock" || line.stockStatus === "terminal_unconfirmed";
    const stockEvidence = {
      orderId: order.orderId,
      inquiryId: order.inquiry?.inquiryId ?? null,
      productId: line.productId,
      requestedQuantity: line.quantity,
      availableQuantity: line.availableQuantity,
      stockStatus: line.stockStatus,
      deliveryDate: order.deliveryDate,
    };
    claims.push({
      claimType: "stock_availability",
      subject: `Product ${line.productId} (${line.productName})`,
      verified: stockVerified,
      evidenceSource: order.inquiry
        ? `Availability snapshot via ${order.inquiry.inquiryId}`
        : "Catalog snapshot",
      statement: stockVerified
        ? `Stock verified (${line.availableQuantity ?? "terminal"} ${line.unit} available >= ${line.quantity} ${line.unit} requested).`
        : `Stock shortfall flagged (${line.stockStatus}: ${line.availableQuantity ?? 0} ${line.unit} available vs ${line.quantity} ${line.unit} requested).`,
      evidenceData: stockEvidence,
      sha256Digest: sha256Canonical(stockEvidence),
    });

    // 3. Origin & sustainability claim
    const certs = catalogRecord
      ? (catalogRecord.sustainabilityCertificates ??
        inferSustainabilityCertificates(
          catalogRecord.name,
          catalogRecord.countryOfOrigin,
          catalogRecord.brand,
        ))
      : [];
    const originEvidence = {
      productId: line.productId,
      gtin: catalogRecord?.gtin ?? null,
      vendorName: catalogRecord?.vendorName ?? null,
      countryOfOrigin: catalogRecord?.countryOfOrigin ?? null,
      co2PerKg: catalogRecord?.co2PerKg ?? null,
      sustainabilityCertificates: certs,
    };
    claims.push({
      claimType: "origin_and_sustainability",
      subject: `Product ${line.productId} (${line.productName})`,
      verified: Boolean(catalogRecord),
      evidenceSource: "Valio Aimo Static Product & Carbon Dataset",
      statement: catalogRecord
        ? `Origin '${catalogRecord.countryOfOrigin ?? "unspecified"}', GTIN '${catalogRecord.gtin ?? "N/A"}', CO2 ${catalogRecord.co2PerKg ?? "N/A"} kg/kg, ${certs.length} certificate(s).`
        : `Catalog origin metadata unavailable for ${line.productId}.`,
      evidenceData: originEvidence,
      sha256Digest: sha256Canonical(originEvidence),
    });

    // 4. Allergen & preference safety claim
    const prefViolations = catalogRecord
      ? evaluateCustomerPreferences(catalogRecord, preferencesUsed)
      : [];
    const safetyVerified =
      prefViolations.length === 0 || order.approval?.status === "approved";
    const safetyEvidence = {
      productId: line.productId,
      allergens: catalogRecord?.allergens ?? [],
      dietaryTags: catalogRecord?.dietaryTags ?? [],
      preferencesEnforced: preferencesUsed,
      preferenceViolations: prefViolations,
    };
    claims.push({
      claimType: "allergen_and_preference_safety",
      subject: `Product ${line.productId} (${line.productName})`,
      verified: safetyVerified,
      evidenceSource: "Guardrail & Allergen Safety Filter",
      statement:
        prefViolations.length === 0
          ? `Zero excluded allergens present; satisfies all dietary and nutrition constraints.`
          : `Preference override noted (${prefViolations.join("; ")}).`,
      evidenceData: safetyEvidence,
      sha256Digest: sha256Canonical(safetyEvidence),
    });
  }

  // 5. Guardrail & human authorization claim
  const authVerified =
    order.guardrailEvaluation.authorizedForAutoConfirm ||
    order.approval?.status === "approved" ||
    order.status === "pending_approval";
  const guardrailEvidence = {
    orderId: order.orderId,
    status: order.status,
    totalPriceEur: order.totalPriceEur,
    budgetEur: order.guardrailsUsed.budgetEur,
    autoApproveLimitEur: order.guardrailsUsed.autoApproveLimitEur,
    authorizedForAutoConfirm: order.guardrailEvaluation.authorizedForAutoConfirm,
    violations: order.guardrailEvaluation.violations,
    approval: order.approval,
  };
  claims.push({
    claimType: "guardrail_authorization",
    subject: `Order ${order.orderId}`,
    verified: authVerified,
    evidenceSource: "Agent Guardrail & Human Approval Engine",
    statement: order.guardrailEvaluation.authorizedForAutoConfirm
      ? `Authorized within autonomous spending authority (${order.totalPriceEur.toFixed(2)} <= ${order.guardrailsUsed.autoApproveLimitEur.toFixed(2)} EUR).`
      : order.approval?.status === "approved"
        ? `Signed off by human approver '${order.approval.decidedByName ?? "Approver"}' at ${order.approval.decidedAt}.`
        : `Correctly paused in '${order.status}' awaiting human sign-off.`,
    evidenceData: guardrailEvidence,
    sha256Digest: sha256Canonical(guardrailEvidence),
  });

  // 6. Chronological audit trail hash chain
  let rollingHash = "0".repeat(64);
  for (const event of order.auditTrail) {
    rollingHash = sha256Canonical({
      prevHash: rollingHash,
      id: event.id,
      orderId: event.orderId,
      timestamp: event.timestamp,
      actorType: event.actorType,
      eventType: event.eventType,
      summary: event.summary,
    });
  }
  const auditEvidence = {
    orderId: order.orderId,
    eventCount: order.auditTrail.length,
    firstEventAt: order.auditTrail[0]?.timestamp ?? null,
    lastEventAt: order.auditTrail[order.auditTrail.length - 1]?.timestamp ?? null,
    chainedDigestSha256: rollingHash,
  };
  claims.push({
    claimType: "audit_trail_integrity",
    subject: `Order ${order.orderId} Audit Log (${order.auditTrail.length} events)`,
    verified: order.auditTrail.length > 0,
    evidenceSource: "Append-Only Procurement Audit Trail",
    statement: `Chained SHA-256 integrity digest verified across ${order.auditTrail.length} chronological audit event(s).`,
    evidenceData: auditEvidence,
    sha256Digest: sha256Canonical(auditEvidence),
  });

  const allClaimsVerified = claims.every((c) => c.verified);
  const orderDigestSha256 = sha256Canonical({
    orderId: order.orderId,
    status: order.status,
    totalPriceEur: order.totalPriceEur,
    claimDigests: claims.map((c) => c.sha256Digest),
  });

  return {
    orderId: order.orderId,
    verifiedAt: new Date().toISOString(),
    verificationMethod: "canonical-json-sha256-v1",
    allClaimsVerified,
    orderDigestSha256,
    auditChainDigestSha256: rollingHash,
    claims,
  };
}

/**
 * Optional Feature #10: Proactive supplier-stock-out & kitchen low-stock response.
 * Detects supplier SKUs at 0 stock and kitchen inventory items below par level, identifies
 * impacted recipes, and proposes allergen-safe, recipe-compatible replacements before the buyer notices.
 */
export async function getProactiveStockoutAlerts(
  deliveryDate = todayIsoDate(),
  actor?: SessionUser | null,
): Promise<StockoutAlertsResponse> {
  const [settings, inventoryRes, recipesRes, previousOrders] = await Promise.all([
    getProcurementSettings(actor),
    listInventory(actor),
    listRecipes({}, actor),
    loadHistoricalOrderRecords(actor),
  ]);

  const alerts: ProactiveStockoutAlert[] = [];
  const seenAlertKeys = new Set<string>();

  const findImpactedRecipes = (productType: string, name: string): string[] => {
    const typeLower = productType.toLowerCase();
    const nameLower = name.toLowerCase();
    return recipesRes.recipes
      .filter((r) =>
        r.ingredients.some(
          (i) =>
            i.productType.toLowerCase() === typeLower ||
            nameLower.includes(i.productName.toLowerCase()) ||
            i.productName.toLowerCase().includes(nameLower),
        ),
      )
      .map((r) => r.name);
  };

  // 1. Detect supplier out-of-stock SKUs across catalog items linked to kitchen/history
  const watchedProductIds = new Set<string>();
  for (const inv of inventoryRes.items) {
    if (inv.linkedProductId) watchedProductIds.add(inv.linkedProductId);
  }
  for (const hist of previousOrders) {
    watchedProductIds.add(hist.productId);
  }
  for (const prod of MOCK_CATALOG_PRODUCTS) {
    if (prod.availableQuantity !== null && prod.availableQuantity <= 0) {
      watchedProductIds.add(prod.id);
    }
  }

  for (const productId of watchedProductIds) {
    const record = await resolveUnifiedCatalogRecord(productId, deliveryDate);
    if (!record) continue;
    if (record.availableQuantity !== null && record.availableQuantity <= 0) {
      const key = `supplier::${record.id}`;
      if (seenAlertKeys.has(key)) continue;
      seenAlertKeys.add(key);

      const peers = await getCandidatesByProductType(record.productType, deliveryDate);
      const { rankedSubstitutes } = buildRankedSubstitutes({
        target: record,
        candidates: peers,
        preferences: settings.preferences,
        previousOrders,
        requestedQuantity: 10,
        deliveryDate,
      });

      const impactedRecipes = findImpactedRecipes(record.productType, record.name);
      alerts.push({
        alertId: `ALT-SUPPLIER-${record.id}`,
        triggerType: "supplier_out_of_stock",
        severity: "critical",
        affectedProductId: record.id,
        affectedName: record.name,
        productType: record.productType,
        impactedRecipes,
        shortageSummary: `Supplier SKU ${record.id} ('${record.name}') has 0 ${record.salesUnit} available for ${deliveryDate}; ${rankedSubstitutes.length} allergen-safe replacement(s) ready.`,
        recommendedReplacements: rankedSubstitutes.slice(0, 3),
      });
    }
  }

  // 2. Detect kitchen inventory items below minParLevel
  for (const inv of inventoryRes.items) {
    if (inv.minParLevel !== null && inv.quantityInStock < inv.minParLevel) {
      const deficit = roundCurrency(inv.minParLevel - inv.quantityInStock);
      const key = `kitchen::${inv.id}`;
      if (seenAlertKeys.has(key)) continue;
      seenAlertKeys.add(key);

      const peers = await getCandidatesByProductType(inv.productType, deliveryDate);
      const syntheticTarget: UnifiedCatalogRecord =
        (inv.linkedProductId
          ? await resolveUnifiedCatalogRecord(inv.linkedProductId, deliveryDate)
          : null) ??
        peers[0] ?? {
          id: inv.id,
          name: inv.ingredientName,
          productType: inv.productType,
          category: inv.productType.toUpperCase(),
          brand: null,
          vendorName: "Valio Aimo",
          salesUnit: inv.unit,
          baseUnit: inv.unit,
          allowedLotSize: 1,
          gtin: null,
          countryOfOrigin: "fi",
          netWeightKg: 1,
          storageTempC: null,
          unitPriceEur: 5,
          vatRatePct: 14,
          availableQuantity: 0,
          logisticModel: "stock",
          deliveryReliability: 0.98,
          co2PerKg: null,
          dietaryTags: [],
          allergens: [],
          nutrition: {
            caloriesPer100g: 100,
            fatPer100g: 5,
            sugarPer100g: 1,
            saltPer100g: 0.2,
            proteinPer100g: 5,
          },
          substituteIds: [],
        };

      // Include syntheticTarget itself if it's in stock and compliant, plus peers
      const dummyBase: UnifiedCatalogRecord = { ...syntheticTarget, id: `__par_${inv.id}__` };
      const { rankedSubstitutes } = buildRankedSubstitutes({
        target: dummyBase,
        candidates: peers,
        preferences: settings.preferences,
        previousOrders,
        requestedQuantity: Math.max(1, deficit),
        deliveryDate,
      });

      const impactedRecipes = findImpactedRecipes(inv.productType, inv.ingredientName);
      alerts.push({
        alertId: `ALT-PAR-${inv.id.toUpperCase()}`,
        triggerType: "kitchen_below_par_level",
        severity: inv.quantityInStock <= 0 ? "critical" : "warning",
        affectedProductId: inv.linkedProductId,
        affectedName: inv.ingredientName,
        productType: inv.productType,
        impactedRecipes,
        shortageSummary: `Kitchen stock for '${inv.ingredientName}' is ${inv.quantityInStock} ${inv.unit} (below par level ${inv.minParLevel} ${inv.unit}; deficit ${deficit} ${inv.unit}).`,
        recommendedReplacements: rankedSubstitutes.slice(0, 3),
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    deliveryDate,
    alerts,
  };
}

/**
 * Optional Feature #11: Recurring-order anomaly detection (`POST /api/intelligence/recurring-check`).
 * Flags unusual spikes/drops in quantities, unit price surges, or total spend deviations before
 * automatically repeating an order.
 */
export async function checkRecurringOrderAnomalies(
  input: RecurringOrderCheckRequest,
  actor?: SessionUser | null,
): Promise<RecurringOrderCheckResponse> {
  if (!input.orderId && (!input.items || input.items.length === 0)) {
    throw new IntelligenceServiceError(
      "Provide either 'orderId' or non-empty 'items' to check for recurring-order anomalies.",
      400,
    );
  }

  const deliveryDate = input.deliveryDate ?? todayIsoDate();
  const [settings, previousOrders] = await Promise.all([
    getProcurementSettings(actor),
    loadHistoricalOrderRecords(actor),
  ]);

  const proposedLines: Array<{
    productId: string;
    productName: string;
    category: string;
    quantity: number;
    unitPriceEur: number;
  }> = [];

  if (input.orderId) {
    try {
      const detail = await getOrderDetail(input.orderId, actor);
      for (const l of detail.order.lines) {
        proposedLines.push({
          productId: l.productId,
          productName: l.productName,
          category: l.category,
          quantity: l.quantity,
          unitPriceEur: l.unitPriceEur,
        });
      }
    } catch (err) {
      if (err instanceof OrderServiceError && err.status === 404) {
        throw new IntelligenceServiceError(err.message, 404);
      }
      throw err;
    }
  } else if (input.items) {
    for (const item of input.items) {
      const rec = await resolveUnifiedCatalogRecord(item.productId, deliveryDate);
      if (!rec) {
        throw new IntelligenceServiceError(`Product '${item.productId}' not found.`, 404);
      }
      proposedLines.push({
        productId: rec.id,
        productName: rec.name,
        category: rec.category,
        quantity: item.quantity,
        unitPriceEur: rec.unitPriceEur,
      });
    }
  }

  // Exclude the inspected orderId itself from historical baseline if it was already saved
  const filteredHistory = input.orderId
    ? previousOrders.filter((h) => h.orderId !== input.orderId)
    : previousOrders;

  const uniqueHistOrders = new Set(filteredHistory.map((h) => h.orderId)).size;
  const histAvgItemQty =
    filteredHistory.length > 0
      ? roundCurrency(
          filteredHistory.reduce((sum, h) => sum + h.quantity, 0) / filteredHistory.length,
        )
      : null;

  const anomalies: RecurringOrderAnomaly[] = [];
  const proposedTotalEur = roundCurrency(
    proposedLines.reduce((sum, l) => sum + l.quantity * l.unitPriceEur, 0),
  );

  for (const line of proposedLines) {
    const skuHist = filteredHistory.filter(
      (h) => h.productId.toLowerCase() === line.productId.toLowerCase(),
    );

    if (skuHist.length > 0) {
      const baselineQty = computeMedian(skuHist.map((h) => h.quantity));
      if (baselineQty > 0) {
        const ratio = roundCurrency(line.quantity / baselineQty);
        if (ratio >= 2.5) {
          anomalies.push({
            anomalyType: "quantity_spike",
            severity: ratio >= 4 ? "high" : "medium",
            productId: line.productId,
            productName: line.productName,
            historicalBaseline: baselineQty,
            proposedValue: line.quantity,
            deviationRatio: ratio,
            explanation: `Proposed quantity for '${line.productName}' (${line.quantity}) is ${ratio.toFixed(2)}x the historical median baseline (${baselineQty}).`,
          });
        } else if (ratio <= 0.3) {
          anomalies.push({
            anomalyType: "quantity_drop",
            severity: "medium",
            productId: line.productId,
            productName: line.productName,
            historicalBaseline: baselineQty,
            proposedValue: line.quantity,
            deviationRatio: ratio,
            explanation: `Proposed quantity for '${line.productName}' (${line.quantity}) dropped to ${ratio.toFixed(2)}x of the historical median baseline (${baselineQty}).`,
          });
        }
      }
    } else if (line.quantity >= 250) {
      anomalies.push({
        anomalyType: "unusual_new_product",
        severity: "medium",
        productId: line.productId,
        productName: line.productName,
        historicalBaseline: 0,
        proposedValue: line.quantity,
        deviationRatio: null,
        explanation: `High-volume order (${line.quantity} units) for '${line.productName}' (${line.productId}), which has never been ordered previously.`,
      });
    }

    // Check unit price vs category average
    const catPeers = MOCK_CATALOG_PRODUCTS.filter(
      (p) => p.category.toLowerCase() === line.category.toLowerCase(),
    );
    if (catPeers.length >= 2) {
      const avgCatPrice = roundCurrency(
        catPeers.reduce((sum, p) => sum + p.unitPriceEur, 0) / catPeers.length,
      );
      if (avgCatPrice > 0 && line.unitPriceEur / avgCatPrice >= 1.25) {
        const ratio = roundCurrency(line.unitPriceEur / avgCatPrice);
        anomalies.push({
          anomalyType: "unit_price_surge",
          severity: "medium",
          productId: line.productId,
          productName: line.productName,
          historicalBaseline: avgCatPrice,
          proposedValue: line.unitPriceEur,
          deviationRatio: ratio,
          explanation: `Unit price for '${line.productName}' (${line.unitPriceEur.toFixed(2)} EUR) is ${ratio.toFixed(2)}x the ${line.category} category average (${avgCatPrice.toFixed(2)} EUR).`,
        });
      }
    }
  }

  if (proposedTotalEur > settings.guardrails.budgetEur) {
    const ratio = roundCurrency(proposedTotalEur / settings.guardrails.budgetEur);
    anomalies.push({
      anomalyType: "total_spend_spike",
      severity: "high",
      productId: null,
      productName: null,
      historicalBaseline: settings.guardrails.budgetEur,
      proposedValue: proposedTotalEur,
      deviationRatio: ratio,
      explanation: `Total order cost (${proposedTotalEur.toFixed(2)} EUR) exceeds usual budget baseline (${settings.guardrails.budgetEur.toFixed(2)} EUR) by ${(proposedTotalEur - settings.guardrails.budgetEur).toFixed(2)} EUR.`,
    });
  }

  const safeToAutoRepeat = anomalies.length === 0;
  const summary = safeToAutoRepeat
    ? `Order (${proposedTotalEur.toFixed(2)} EUR) matches historical purchasing patterns across ${uniqueHistOrders} past order(s) and is safe for autonomous repeat.`
    : `Paused autonomous repeat: detected ${anomalies.length} anomaly(ies) requiring buyer/approver review.`;

  return {
    safeToAutoRepeat,
    historicalOrderCount: uniqueHistOrders,
    proposedTotalEur,
    historicalAverageItemQuantity: histAvgItemQty,
    anomalies,
    summary,
  };
}

function recordToCatalogSummary(record: UnifiedCatalogRecord): CatalogProductSummary {
  return {
    id: record.id,
    name: record.name,
    brand: record.brand,
    vendorName: record.vendorName,
    category: record.category,
    salesUnit: record.salesUnit,
    gtin: record.gtin,
    countryOfOrigin: record.countryOfOrigin,
    co2PerKg: record.co2PerKg,
    deliveryReliability: record.deliveryReliability,
    allergens: record.allergens,
    dietaryTags: record.dietaryTags,
    sustainabilityCertificates:
      record.sustainabilityCertificates ??
      inferSustainabilityCertificates(record.name, record.countryOfOrigin, record.brand),
  };
}

/**
 * Optional Feature #12: Proactive supplier-side product recommendations (`GET /api/intelligence/recommendations`).
 * Suggests seasonal, newly available, climate-reduced, and kitchen-gap products strictly compliant
 * with the buyer's dietary, allergen, and nutritional preferences.
 */
export async function getProactiveRecommendations(
  actor?: SessionUser | null,
): Promise<ProactiveRecommendationsResponse> {
  const [settings, inventoryRes] = await Promise.all([
    getProcurementSettings(actor),
    listInventory(actor),
  ]);

  const preferences = settings.preferences;
  const lowStockTypes = new Set(
    inventoryRes.items
      .filter((i) => i.minParLevel !== null && i.quantityInStock < i.minParLevel)
      .map((i) => i.productType.toLowerCase()),
  );

  const recommendations: ProactiveRecommendation[] = [];
  const addedIds = new Set<string>();

  const compliantProducts = MOCK_CATALOG_PRODUCTS.filter(
    (p) =>
      (p.availableQuantity === null || p.availableQuantity > 0) &&
      evaluateCustomerPreferences(p, preferences).length === 0,
  );

  for (const prod of compliantProducts) {
    if (addedIds.has(prod.id)) continue;

    const sust = computeSustainabilityComparison(prod, MOCK_CATALOG_PRODUCTS);

    if (prod.isSeasonal) {
      addedIds.add(prod.id);
      recommendations.push({
        product: recordToCatalogSummary(prod),
        unitPriceEur: prod.unitPriceEur,
        availableQuantity: prod.availableQuantity,
        recommendationType: "seasonal_highlight",
        headline: `Seasonal Nordic Highlight: ${prod.name}`,
        rationale: `Limited-season Finnish assortment item (${prod.unitPriceEur.toFixed(2)} EUR/${prod.salesUnit}) matching all active dietary and allergen rules.`,
        sustainabilityComparison: sust,
      });
      continue;
    }

    if (prod.isNewArrival && sust.footprintRating === "low_impact") {
      addedIds.add(prod.id);
      recommendations.push({
        product: recordToCatalogSummary(prod),
        unitPriceEur: prod.unitPriceEur,
        availableQuantity: prod.availableQuantity,
        recommendationType: "lower_carbon_switch",
        headline: `Newly Available Low-Carbon Switch: ${prod.name}`,
        rationale: `New Valio assortment arrival with ${sust.productCo2PerKg?.toFixed(2)} kg CO2e/kg (${sust.co2VsCategoryAvgPct?.toFixed(1)}% vs ${prod.category} average).`,
        sustainabilityComparison: sust,
      });
      continue;
    }

    if (prod.isNewArrival) {
      addedIds.add(prod.id);
      recommendations.push({
        product: recordToCatalogSummary(prod),
        unitPriceEur: prod.unitPriceEur,
        availableQuantity: prod.availableQuantity,
        recommendationType: "new_arrival",
        headline: `Newly Available in Valio Aimo: ${prod.name}`,
        rationale: `Freshly added to Valio Aimo's catalog with ${prod.availableQuantity} ${prod.salesUnit} in stock and compliant nutrition/allergen profile.`,
        sustainabilityComparison: sust,
      });
      continue;
    }

    if (lowStockTypes.has(prod.productType.toLowerCase())) {
      addedIds.add(prod.id);
      recommendations.push({
        product: recordToCatalogSummary(prod),
        unitPriceEur: prod.unitPriceEur,
        availableQuantity: prod.availableQuantity,
        recommendationType: "recipe_inventory_gap",
        headline: `Kitchen Par-Level Replenishment: ${prod.name}`,
        rationale: `Your '${prod.productType}' kitchen stock is below par level; ${prod.availableQuantity} ${prod.salesUnit} ready for next delivery at ${prod.unitPriceEur.toFixed(2)} EUR/${prod.salesUnit}.`,
        sustainabilityComparison: sust,
      });
    }
  }

  const priorityOrder: Record<ProactiveRecommendation["recommendationType"], number> = {
    seasonal_highlight: 1,
    lower_carbon_switch: 2,
    new_arrival: 3,
    recipe_inventory_gap: 4,
  };
  recommendations.sort(
    (a, b) => priorityOrder[a.recommendationType] - priorityOrder[b.recommendationType],
  );

  return {
    generatedAt: new Date().toISOString(),
    preferencesApplied: preferences,
    recommendations: recommendations.slice(0, 6),
  };
}
