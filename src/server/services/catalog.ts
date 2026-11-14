import "server-only";

import { and, asc, count, desc, eq, gt, inArray, like, type SQL } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import {
  valioAvailabilitySnapshot,
  valioPriceSnapshot,
  valioProduct,
  valioProductSubstitute,
  valioProductUnit,
  type ValioAvailabilitySnapshotRow,
  type ValioPriceSnapshotRow,
} from "@/server/db/schema";
import { VALIO_UNKNOWN_AMOUNT } from "@/server/valio/api-schemas";
import { fetchAvailability, fetchPrices, valioSource } from "@/server/valio/client";
import type { Offer, OffersResponse } from "@/shared/contracts/products";
import type {
  Availability,
  AvailabilityRequest,
  AvailabilityResponse,
  PriceQuote,
  PricesRequest,
  PricesResponse,
  ProductDetail,
  ProductSearchQuery,
  ProductSearchResponse,
  ProductSummary,
} from "@/server/valio/types";

// Catalog: static product data from Postgres (pnpm data:import), live prices and availability
// from the Valio API. Used by the HTTP routes (routes/products) and the purchasing agent's tools.
// Every live answer is stored as a snapshot (audit trail) and reused for CACHE_MINUTES so
// repeated questions don't hit Valio's rate limits.

const CACHE_MINUTES = 5;

const summaryColumns = {
  id: valioProduct.id,
  name: valioProduct.name,
  brand: valioProduct.brand,
  vendorName: valioProduct.vendorName,
  category: valioProduct.category,
  salesUnit: valioProduct.salesUnit,
  gtin: valioProduct.gtin,
  temperatureCondition: valioProduct.temperatureCondition,
  countryOfOrigin: valioProduct.countryOfOrigin,
  co2PerKg: valioProduct.co2PerKg,
  deliveryReliability: valioProduct.deliveryReliability,
  hasImage: valioProduct.hasImage,
} as const;

async function db() {
  await ensureDatabase();
  return getDb();
}

const cacheCutoff = () => new Date(Date.now() - CACHE_MINUTES * 60_000);

// ---------- Products ----------

export async function searchProducts(query: ProductSearchQuery): Promise<ProductSearchResponse> {
  const d = await db();
  const conditions: SQL[] = [];
  for (const word of (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
    // Escape LIKE wildcards so "50%" matches literally.
    conditions.push(like(valioProduct.searchText, `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  }
  if (query.category) conditions.push(eq(valioProduct.category, query.category));
  const where = conditions.length ? and(...conditions) : undefined;

  const [[totalRow], items] = await Promise.all([
    d.select({ total: count() }).from(valioProduct).where(where),
    d
      .select(summaryColumns)
      .from(valioProduct)
      .where(where)
      .orderBy(asc(valioProduct.name), asc(valioProduct.id))
      .limit(query.limit)
      .offset(query.offset),
  ]);
  return { total: totalRow?.total ?? 0, items: items satisfies ProductSummary[] };
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const d = await db();
  const [r] = await d.select().from(valioProduct).where(eq(valioProduct.id, id));
  if (!r) return null;

  const [units, substitutes] = await Promise.all([
    d
      .select({
        unitId: valioProductUnit.unitId,
        gtin: valioProductUnit.gtin,
        sizeInBaseUnits: valioProductUnit.sizeInBaseUnits,
      })
      .from(valioProductUnit)
      .where(eq(valioProductUnit.productId, id))
      .orderBy(asc(valioProductUnit.sizeInBaseUnits)),
    d
      .select(summaryColumns)
      .from(valioProduct)
      .where(
        inArray(
          valioProduct.id,
          d
            .select({ id: valioProductSubstitute.substituteId })
            .from(valioProductSubstitute)
            .where(eq(valioProductSubstitute.productId, id)),
        ),
      )
      .orderBy(asc(valioProduct.name)),
  ]);

  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    vendorName: r.vendorName,
    category: r.category,
    salesUnit: r.salesUnit,
    gtin: r.gtin,
    temperatureCondition: r.temperatureCondition,
    countryOfOrigin: r.countryOfOrigin,
    co2PerKg: r.co2PerKg,
    deliveryReliability: r.deliveryReliability,
    hasImage: r.hasImage,
    names: { en: r.name, fi: r.nameFi, sv: r.nameSv },
    baseUnit: r.baseUnit,
    allowedLotSize: r.allowedLotSize,
    units,
    allergens: r.allergens,
    storageTempC:
      r.storageTempMin === null && r.storageTempMax === null
        ? null
        : { min: r.storageTempMin, max: r.storageTempMax },
    netWeightKg: r.netWeightKg,
    co2PerBaseUnit: r.co2PerBaseUnit,
    vatCode: r.vatCode,
    substitutes,
  };
}

/** Splits requested ids into known products (with their sales unit) and unknown codes. */
async function knownProducts(ids: string[]) {
  const d = await db();
  const unique = [...new Set(ids)];
  const rows = await d
    .select({ id: valioProduct.id, salesUnit: valioProduct.salesUnit })
    .from(valioProduct)
    .where(inArray(valioProduct.id, unique));
  const salesUnits = new Map(rows.map((r) => [r.id, r.salesUnit]));
  return {
    d,
    known: unique.filter((id) => salesUnits.has(id)),
    unknown: unique.filter((id) => !salesUnits.has(id)),
    salesUnits,
  };
}

// ---------- Prices ----------

export async function getPrices({ productIds, date }: PricesRequest): Promise<PricesResponse> {
  const { d, known, unknown, salesUnits } = await knownProducts(productIds);
  const source = valioSource();

  // Fresh snapshots from the same source are reused; the rest is fetched from Valio.
  const cached = known.length
    ? await d
        .selectDistinctOn([valioPriceSnapshot.productId])
        .from(valioPriceSnapshot)
        .where(
          and(
            inArray(valioPriceSnapshot.productId, known),
            eq(valioPriceSnapshot.pricingDate, date),
            eq(valioPriceSnapshot.source, source),
            gt(valioPriceSnapshot.fetchedAt, cacheCutoff()),
          ),
        )
        .orderBy(valioPriceSnapshot.productId, desc(valioPriceSnapshot.fetchedAt))
    : [];
  const missing = known.filter((id) => !cached.some((r) => r.productId === id));
  const fetched = await fetchPrices(missing, date);

  const inserted: ValioPriceSnapshotRow[] = fetched.length
    ? await d
        .insert(valioPriceSnapshot)
        .values(
          fetched.map((p) => ({
            productId: p.productId,
            pricingDate: date,
            source,
            currency: p.catalogPrice?.currency ?? p.priceWithTax?.currency ?? null,
            priceExclVat: p.error ? null : (p.catalogPrice?.value ?? null),
            priceInclVat: p.error ? null : (p.priceWithTax?.value ?? p.catalogPrice?.valueWithTax ?? null),
            vatRate: p.tax?.taxRate ?? null,
            listPriceExclVat: p.listPrice?.value ?? null,
            comparisonPrice: p.comparisonPrice?.value ?? null,
            comparisonUnit: p.comparisonUnit ?? null,
            customerPrice: p.netPriceFound,
            validFrom: p.catalogPrice?.validFrom ?? p.priceWithTax?.validFrom ?? null,
            validTo: p.catalogPrice?.validTo ?? p.priceWithTax?.validTo ?? null,
            error: p.error,
          })),
        )
        .returning()
    : [];

  const byId = new Map([...cached, ...inserted].map((r) => [r.productId, r]));
  const quotes: PriceQuote[] = known.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return []; // Valio returned nothing for it: leave it out rather than invent a price.
    const found = !r.error && r.priceExclVat !== null;
    return [
      {
        productId: id,
        found,
        salesUnit: salesUnits.get(id)!,
        priceExclVat: found ? r.priceExclVat : null,
        priceInclVat: found ? r.priceInclVat : null,
        vatRatePct: r.vatRate,
        listPriceExclVat: r.listPriceExclVat,
        customerPrice: r.customerPrice,
        comparisonPrice: r.comparisonPrice,
        comparisonUnit: r.comparisonUnit,
        validFrom: r.validFrom,
        validTo: r.validTo,
        fetchedAt: r.fetchedAt.toISOString(),
      },
    ];
  });

  const currency = [...byId.values()].find((r) => r.currency)?.currency ?? "EUR";
  return { pricingDate: date, currency, source, quotes, unknownProductIds: unknown };
}

// ---------- Availability ----------

function toLogisticModel(value: string | null): Availability["logisticModel"] {
  const v = value?.toLowerCase();
  return v === "stock" || v === "terminal" ? v : null;
}

export async function getAvailability({ productIds, date }: AvailabilityRequest): Promise<AvailabilityResponse> {
  const { d, known, unknown } = await knownProducts(productIds);
  const source = valioSource();

  const cached = known.length
    ? await d
        .selectDistinctOn([valioAvailabilitySnapshot.productId])
        .from(valioAvailabilitySnapshot)
        .where(
          and(
            inArray(valioAvailabilitySnapshot.productId, known),
            eq(valioAvailabilitySnapshot.requestedDate, date),
            eq(valioAvailabilitySnapshot.source, source),
            gt(valioAvailabilitySnapshot.fetchedAt, cacheCutoff()),
          ),
        )
        .orderBy(valioAvailabilitySnapshot.productId, desc(valioAvailabilitySnapshot.fetchedAt))
    : [];
  const missing = known.filter((id) => !cached.some((r) => r.productId === id));
  const fetched = await fetchAvailability(missing, date);

  const inserted: ValioAvailabilitySnapshotRow[] = fetched.length
    ? await d
        .insert(valioAvailabilitySnapshot)
        .values(
          fetched.map((a) => {
            // Valio sends at most one schedule line; no line = not deliverable on any date.
            const line = a.scheduleLines[0];
            return {
              productId: a.productId,
              requestedDate: date,
              source,
              salesBlock: a.salesBlock || (line?.salesBlock ?? false),
              logisticModel: a.logisticModel ?? null,
              closingTime: a.closingTime ?? null,
              availableAmount: line?.availableAmount ?? null,
              availableDate: line?.availableDate ?? null,
              salesUnit: line?.salesUnit ?? null,
            };
          }),
        )
        .returning()
    : [];

  const byId = new Map([...cached, ...inserted].map((r) => [r.productId, r]));
  const items: Availability[] = known.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const amount = r.availableAmount;
    const unknownAmount = amount === VALIO_UNKNOWN_AMOUNT;
    return [
      {
        productId: id,
        orderable: !r.salesBlock && amount !== null && amount > 0,
        salesBlock: r.salesBlock,
        logisticModel: toLogisticModel(r.logisticModel),
        availableQuantity: amount === null || unknownAmount ? null : amount,
        availableDate: r.availableDate,
        orderCutoff: r.closingTime,
        salesUnit: r.salesUnit,
        fetchedAt: r.fetchedAt.toISOString(),
      },
    ];
  });

  return { requestedDate: date, source, items, unknownProductIds: unknown };
}

// ---------- Offers ----------

/** Today's date in Helsinki (YYYY-MM-DD): the default delivery date. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date());
}

/** Price and availability for the same products and delivery date, combined per product. */
export async function getOffers(productIds: string[], date: string = today()): Promise<OffersResponse> {
  const [prices, availability] = await Promise.all([
    getPrices({ productIds, date }),
    getAvailability({ productIds, date }),
  ]);
  const priceById = new Map(prices.quotes.map((q) => [q.productId, q]));
  const availabilityById = new Map(availability.items.map((a) => [a.productId, a]));
  const unknown = new Set(prices.unknownProductIds);
  const offers: Offer[] = [...new Set(productIds)]
    .filter((id) => !unknown.has(id))
    .map((id) => ({
      productId: id,
      date,
      price: priceById.get(id) ?? null,
      availability: availabilityById.get(id) ?? null,
    }));
  return {
    date,
    source: prices.source,
    currency: prices.currency,
    offers,
    unknownProductIds: prices.unknownProductIds,
  };
}
