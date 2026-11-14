import "server-only";

import { randomUUID } from "node:crypto";

import { getAvailability, getPrices, getProduct, today } from "@/server/services/catalog";
import {
  MOCK_CATALOG_BY_ID,
  realProductFacts,
  roundCurrency,
  type UnifiedCatalogRecord,
} from "@/server/services/mock-catalog";
import { valioSource } from "@/server/valio/client";
import type {
  CreateInquiryRequest,
  InquiryLineQuote,
  PriceAvailabilityInquiry,
  StockStatus,
} from "@/shared/contracts/catalog";

const INQUIRY_LOCK_MINUTES = 5;
const DEFAULT_FOOD_VAT_PCT = 14;

/** Today in Helsinki (YYYY-MM-DD), the same default as the rest of the API. */
export function todayIsoDate(): string {
  return today();
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

    let unitPriceEur: number | null = null;
    let vatRatePct = DEFAULT_FOOD_VAT_PCT;
    let availableQuantity: number | null = null;
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
      // Valio unavailable: no price, so the product can't be offered below.
    }
    if (unitPriceEur === null) return null;

    const { dietaryTags, allergens, nutrition } = realProductFacts(detail);

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
      nutrition,
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
