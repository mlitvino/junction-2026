import "server-only";

import { randomUUID } from "node:crypto";

import { getAvailability, getPrices, getProduct, searchProducts } from "@/server/services/catalog";
import {
  hashSeed,
  inferDietaryAndAllergensFromProduct,
  inferSustainabilityCertificates,
  MOCK_CATALOG_BY_ID,
  MOCK_CATALOG_PRODUCTS,
  roundCurrency,
  synthesizeNutritionFromSeed,
  type UnifiedCatalogRecord,
} from "@/server/services/mock-catalog";
import { valioSource } from "@/server/valio/client";
import type { ProductDetail, ProductSummary } from "@/server/valio/types";
import type {
  CatalogProductDetail,
  CatalogProductSummary,
  CatalogSearchQuery,
  CatalogSearchResponse,
  CreateInquiryRequest,
  InquiryLineQuote,
  PriceAvailabilityInquiry,
  StockStatus,
} from "@/shared/contracts/catalog";

const INQUIRY_LOCK_MINUTES = 5;
const DEFAULT_FOOD_VAT_PCT = 14;

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toSummaryFromMock(record: UnifiedCatalogRecord): CatalogProductSummary {
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

function toSummaryFromDb(item: ProductSummary, rawAllergens: string[] = []): CatalogProductSummary {
  const { dietaryTags, allergens } = inferDietaryAndAllergensFromProduct(item.name, rawAllergens);
  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    vendorName: item.vendorName,
    category: item.category,
    salesUnit: item.salesUnit,
    gtin: item.gtin,
    countryOfOrigin: item.countryOfOrigin,
    co2PerKg: item.co2PerKg,
    deliveryReliability: item.deliveryReliability,
    allergens,
    dietaryTags,
    sustainabilityCertificates: inferSustainabilityCertificates(
      item.name,
      item.countryOfOrigin,
      item.brand,
    ),
  };
}

function matchesMockSearch(record: UnifiedCatalogRecord, query: CatalogSearchQuery): boolean {
  if (query.category) {
    const cat = query.category.toLowerCase();
    if (
      record.category.toLowerCase() !== cat &&
      !record.category.toLowerCase().includes(cat) &&
      !record.productType.toLowerCase().includes(cat)
    ) {
      return false;
    }
  }
  if (query.q) {
    const haystack = [
      record.id,
      record.name,
      record.brand ?? "",
      record.vendorName,
      record.category,
      record.productType,
      record.gtin ?? "",
    ]
      .join(" ")
      .toLowerCase();
    const words = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}

function filterByAllergenAndDietary(
  item: CatalogProductSummary,
  excludeAllergens: string[],
  requiredDietary: string[],
): boolean {
  if (excludeAllergens.length > 0) {
    const itemAllergens = new Set(item.allergens.map((a) => a.toLowerCase()));
    if (excludeAllergens.some((ex) => itemAllergens.has(ex))) return false;
  }
  if (requiredDietary.length > 0) {
    const itemDietary = new Set(item.dietaryTags.map((d) => d.toLowerCase()));
    if (!requiredDietary.every((req) => itemDietary.has(req))) return false;
  }
  return true;
}

/**
 * Structured product search across Postgres `valio_product` (when available) and the synthetic
 * mock catalog, supporting text query, category, allergen exclusion, and dietary tags.
 */
export async function searchCatalogProducts(
  query: CatalogSearchQuery,
): Promise<CatalogSearchResponse> {
  const excludeAllergens = (query.excludeAllergens ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const requiredDietary = (query.dietary ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const merged = new Map<string, CatalogProductSummary>();

  for (const mock of MOCK_CATALOG_PRODUCTS) {
    if (matchesMockSearch(mock, query)) {
      const summary = toSummaryFromMock(mock);
      if (filterByAllergenAndDietary(summary, excludeAllergens, requiredDietary)) {
        merged.set(summary.id, summary);
      }
    }
  }

  if (process.env.DATABASE_URL) {
    try {
      const dbResult = await searchProducts({
        q: query.q,
        category: query.category,
        limit: Math.min(100, query.limit + query.offset + 20),
        offset: 0,
      });
      for (const item of dbResult.items) {
        if (!merged.has(item.id)) {
          const summary = toSummaryFromDb(item);
          if (filterByAllergenAndDietary(summary, excludeAllergens, requiredDietary)) {
            merged.set(summary.id, summary);
          }
        }
      }
    } catch {
      // Database unavailable; serve matching synthetic mock catalog products.
    }
  }

  const all = [...merged.values()];
  const paged = all.slice(query.offset, query.offset + query.limit);
  return {
    total: all.length,
    items: paged,
  };
}

/**
 * Retrieves full product detail including nutrition and suggested substitutes.
 */
export async function getCatalogProductDetail(
  productId: string,
): Promise<CatalogProductDetail | null> {
  const mock = MOCK_CATALOG_BY_ID.get(productId);
  if (mock) {
    const substitutes = mock.substituteIds
      .map((id) => MOCK_CATALOG_BY_ID.get(id))
      .filter((p): p is UnifiedCatalogRecord => Boolean(p))
      .map(toSummaryFromMock);

    return {
      ...toSummaryFromMock(mock),
      baseUnit: mock.baseUnit,
      allowedLotSize: mock.allowedLotSize,
      netWeightKg: mock.netWeightKg,
      storageTempC: mock.storageTempC,
      nutrition: mock.nutrition,
      substitutes,
    };
  }

  if (process.env.DATABASE_URL) {
    try {
      const detail: ProductDetail | null = await getProduct(productId);
      if (detail) {
        const { dietaryTags, allergens } = inferDietaryAndAllergensFromProduct(
          detail.name,
          detail.allergens,
        );
        return {
          id: detail.id,
          name: detail.name,
          brand: detail.brand,
          vendorName: detail.vendorName,
          category: detail.category,
          salesUnit: detail.salesUnit,
          gtin: detail.gtin,
          countryOfOrigin: detail.countryOfOrigin,
          co2PerKg: detail.co2PerKg,
          deliveryReliability: detail.deliveryReliability,
          allergens,
          dietaryTags,
          baseUnit: detail.baseUnit,
          allowedLotSize: detail.allowedLotSize,
          netWeightKg: detail.netWeightKg,
          storageTempC: detail.storageTempC,
          nutrition: synthesizeNutritionFromSeed(detail.id),
          substitutes: detail.substitutes.map((s) => toSummaryFromDb(s)),
        };
      }
    } catch {
      // Fall through to null when DB is unreachable.
    }
  }

  return null;
}

/**
 * Resolves a unified candidate record by product ID (from mock catalog or Postgres `valio_product`).
 */
export async function resolveUnifiedCatalogRecord(
  productId: string,
  deliveryDate = todayIsoDate(),
): Promise<UnifiedCatalogRecord | null> {
  const mock = MOCK_CATALOG_BY_ID.get(productId);
  if (mock) return mock;

  if (!process.env.DATABASE_URL) return null;

  try {
    const detail = await getProduct(productId);
    if (!detail) return null;

    const s = hashSeed(detail.id);
    let unitPriceEur = roundCurrency(2 + s * 12);
    let vatRatePct = DEFAULT_FOOD_VAT_PCT;
    let availableQuantity: number | null = Math.max(50, Math.floor(s * 600));
    let logisticModel: "stock" | "terminal" = "stock";

    try {
      const [prices, availability] = await Promise.all([
        getPrices({ productIds: [detail.id], date: deliveryDate }),
        getAvailability({ productIds: [detail.id], date: deliveryDate }),
      ]);
      const q = prices.quotes[0];
      if (q && q.found && q.priceExclVat !== null) {
        unitPriceEur = q.priceExclVat;
        vatRatePct = q.vatRatePct ?? DEFAULT_FOOD_VAT_PCT;
      }
      const a = availability.items[0];
      if (a) {
        availableQuantity = a.salesBlock ? 0 : a.availableQuantity;
        logisticModel = a.logisticModel ?? "stock";
      }
    } catch {
      // Keep deterministic price/stock fallback if live call fails.
    }

    const { dietaryTags, allergens } = inferDietaryAndAllergensFromProduct(
      detail.name,
      detail.allergens,
    );

    return {
      id: detail.id,
      name: detail.name,
      productType: detail.category,
      category: detail.category,
      brand: detail.brand,
      vendorName: detail.vendorName,
      salesUnit: detail.salesUnit,
      baseUnit: detail.baseUnit,
      allowedLotSize: detail.allowedLotSize,
      gtin: detail.gtin,
      countryOfOrigin: detail.countryOfOrigin,
      netWeightKg: detail.netWeightKg,
      storageTempC: detail.storageTempC,
      unitPriceEur,
      vatRatePct,
      availableQuantity,
      logisticModel,
      deliveryReliability: detail.deliveryReliability,
      co2PerKg: detail.co2PerKg,
      dietaryTags,
      allergens,
      nutrition: synthesizeNutritionFromSeed(detail.id),
      substituteIds: detail.substitutes.map((sub) => sub.id),
    };
  } catch {
    return null;
  }
}

export function classifyStockStatus(params: {
  orderable: boolean;
  salesBlock: boolean;
  logisticModel: "stock" | "terminal" | null;
  availableQuantity: number | null;
  requestedQuantity: number;
}): { stockStatus: StockStatus; shortfallQuantity: number; canFulfill: boolean } {
  const { orderable, salesBlock, logisticModel, availableQuantity, requestedQuantity } = params;
  if (salesBlock || !orderable) {
    return {
      stockStatus: "out_of_stock",
      shortfallQuantity: roundCurrency(requestedQuantity),
      canFulfill: false,
    };
  }
  if (logisticModel === "terminal" && availableQuantity === null) {
    return {
      stockStatus: "terminal_unconfirmed",
      shortfallQuantity: 0,
      canFulfill: true,
    };
  }
  if (availableQuantity === null || availableQuantity <= 0) {
    return {
      stockStatus: "out_of_stock",
      shortfallQuantity: roundCurrency(requestedQuantity),
      canFulfill: false,
    };
  }
  if (availableQuantity < requestedQuantity) {
    return {
      stockStatus: "partial_stock",
      shortfallQuantity: roundCurrency(requestedQuantity - availableQuantity),
      canFulfill: false,
    };
  }
  return {
    stockStatus: "in_stock",
    shortfallQuantity: 0,
    canFulfill: true,
  };
}

/**
 * Executes a Price-and-Availability Inquiry (Core Feature #5) confirming what can be ordered
 * and locking fixed unit prices before order commitment.
 */
export async function createPriceAvailabilityInquiry(
  input: CreateInquiryRequest,
): Promise<PriceAvailabilityInquiry> {
  const deliveryDate = input.deliveryDate ?? todayIsoDate();
  const now = new Date();
  const quotedAt = now.toISOString();
  const validUntil = new Date(now.getTime() + INQUIRY_LOCK_MINUTES * 60_000).toISOString();

  const nonMockIds = [
    ...new Set(input.items.map((i) => i.productId).filter((id) => !MOCK_CATALOG_BY_ID.has(id))),
  ];

  const dbPriceMap = new Map<
    string,
    {
      found: boolean;
      salesUnit: string;
      priceExclVat: number | null;
      priceInclVat: number | null;
      vatRatePct: number | null;
      fetchedAt: string;
    }
  >();
  const dbAvailMap = new Map<
    string,
    {
      orderable: boolean;
      salesBlock: boolean;
      logisticModel: "stock" | "terminal" | null;
      availableQuantity: number | null;
      availableDate: string | null;
      orderCutoff: string | null;
      fetchedAt: string;
    }
  >();
  const dbNames = new Map<string, string>();

  if (nonMockIds.length > 0 && process.env.DATABASE_URL) {
    try {
      const [prices, availability, details] = await Promise.all([
        getPrices({ productIds: nonMockIds, date: deliveryDate }),
        getAvailability({ productIds: nonMockIds, date: deliveryDate }),
        Promise.all(nonMockIds.map((id) => getProduct(id))),
      ]);
      for (const d of details) {
        if (d) dbNames.set(d.id, d.name);
      }
      for (const q of prices.quotes) {
        dbPriceMap.set(q.productId, {
          found: q.found,
          salesUnit: q.salesUnit,
          priceExclVat: q.priceExclVat,
          priceInclVat: q.priceInclVat,
          vatRatePct: q.vatRatePct,
          fetchedAt: q.fetchedAt,
        });
      }
      for (const a of availability.items) {
        dbAvailMap.set(a.productId, {
          orderable: a.orderable,
          salesBlock: a.salesBlock,
          logisticModel: a.logisticModel,
          availableQuantity: a.availableQuantity,
          availableDate: a.availableDate,
          orderCutoff: a.orderCutoff,
          fetchedAt: a.fetchedAt,
        });
      }
    } catch {
      // If DB lookup fails, non-mock IDs without DB records will be reported in unknownProductIds.
    }
  }

  const lines: InquiryLineQuote[] = [];
  const unknownProductIds: string[] = [];

  for (const reqItem of input.items) {
    const mock = MOCK_CATALOG_BY_ID.get(reqItem.productId);
    if (mock) {
      const unitExcl = mock.unitPriceEur;
      const vatRate = mock.vatRatePct;
      const unitIncl = roundCurrency(unitExcl * (1 + vatRate / 100));
      const lineExcl = roundCurrency(unitExcl * reqItem.quantity);
      const lineIncl = roundCurrency(lineExcl * (1 + vatRate / 100));
      const orderable = mock.availableQuantity === null || mock.availableQuantity > 0;
      const { stockStatus, shortfallQuantity, canFulfill } = classifyStockStatus({
        orderable,
        salesBlock: false,
        logisticModel: mock.logisticModel,
        availableQuantity: mock.availableQuantity,
        requestedQuantity: reqItem.quantity,
      });

      lines.push({
        productId: mock.id,
        productName: mock.name,
        requestedQuantity: reqItem.quantity,
        salesUnit: mock.salesUnit,
        priceFound: true,
        fixedUnitPriceExclVat: unitExcl,
        fixedUnitPriceInclVat: unitIncl,
        vatRatePct: vatRate,
        lineTotalExclVat: lineExcl,
        lineTotalInclVat: lineIncl,
        orderable,
        salesBlock: false,
        logisticModel: mock.logisticModel,
        availableQuantity: mock.availableQuantity,
        stockStatus,
        shortfallQuantity,
        canFulfillRequestedQuantity: canFulfill,
        earliestAvailableDate: deliveryDate,
        orderCutoff: `${deliveryDate}T10:00:00`,
        fetchedAt: quotedAt,
      });
      continue;
    }

    const dbName = dbNames.get(reqItem.productId);
    const p = dbPriceMap.get(reqItem.productId);
    const a = dbAvailMap.get(reqItem.productId);

    if (!dbName || (!p && !a)) {
      unknownProductIds.push(reqItem.productId);
      continue;
    }

    const vatRate = p?.vatRatePct ?? DEFAULT_FOOD_VAT_PCT;
    const unitExcl = p?.found ? p.priceExclVat : null;
    const unitIncl =
      unitExcl !== null ? (p?.priceInclVat ?? roundCurrency(unitExcl * (1 + vatRate / 100))) : null;
    const lineExcl = unitExcl !== null ? roundCurrency(unitExcl * reqItem.quantity) : null;
    const lineIncl = lineExcl !== null ? roundCurrency(lineExcl * (1 + vatRate / 100)) : null;

    const orderable = a?.orderable ?? false;
    const salesBlock = a?.salesBlock ?? false;
    const logisticModel = a?.logisticModel ?? null;
    const availableQuantity = a?.availableQuantity ?? null;

    const { stockStatus, shortfallQuantity, canFulfill } = classifyStockStatus({
      orderable,
      salesBlock,
      logisticModel,
      availableQuantity,
      requestedQuantity: reqItem.quantity,
    });

    lines.push({
      productId: reqItem.productId,
      productName: dbName,
      requestedQuantity: reqItem.quantity,
      salesUnit: p?.salesUnit ?? "ST",
      priceFound: Boolean(p?.found && unitExcl !== null),
      fixedUnitPriceExclVat: unitExcl,
      fixedUnitPriceInclVat: unitIncl,
      vatRatePct: vatRate,
      lineTotalExclVat: lineExcl,
      lineTotalInclVat: lineIncl,
      orderable,
      salesBlock,
      logisticModel,
      availableQuantity,
      stockStatus,
      shortfallQuantity,
      canFulfillRequestedQuantity: Boolean(p?.found && unitExcl !== null && canFulfill),
      earliestAvailableDate: a?.availableDate ?? null,
      orderCutoff: a?.orderCutoff ?? null,
      fetchedAt: p?.fetchedAt ?? a?.fetchedAt ?? quotedAt,
    });
  }

  const totalExclVatEur = roundCurrency(
    lines.reduce((sum, l) => sum + (l.lineTotalExclVat ?? 0), 0),
  );
  const totalInclVatEur = roundCurrency(
    lines.reduce((sum, l) => sum + (l.lineTotalInclVat ?? 0), 0),
  );
  const allOrderable =
    lines.length > 0 &&
    unknownProductIds.length === 0 &&
    lines.every((l) => l.priceFound && l.canFulfillRequestedQuantity);

  return {
    inquiryId: `INQ-${randomUUID().slice(0, 8).toUpperCase()}`,
    deliveryDate,
    quotedAt,
    validUntil,
    source: valioSource(),
    currency: "EUR",
    lines,
    totalExclVatEur,
    totalInclVatEur,
    allOrderable,
    unknownProductIds,
  };
}
