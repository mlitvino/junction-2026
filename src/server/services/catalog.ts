import "server-only";

import {
  ensureCatalogSchema,
  type AvailabilitySnapshotRow,
  type PriceSnapshotRow,
  type ProductRow,
  type ProductUnitRow,
} from "@/server/db/catalog-schema";
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
import { getPool } from "@/server/db/pool";
import { VALIO_UNKNOWN_AMOUNT } from "@/server/valio/api-schemas";
import { fetchAvailability, fetchPrices, valioSource } from "@/server/valio/client";

// Catalog: static product data from Postgres (pnpm data:import), live prices and availability
// from the Valio API. Server-internal (no HTTP endpoint): meant for the purchasing agent's tools.
// Every live answer is stored as a snapshot (audit trail) and reused for CACHE_MINUTES so
// repeated questions don't hit Valio's rate limits.

const CACHE_MINUTES = 5;

const SUMMARY_COLUMNS = `id, name, brand, vendor_name, category, sales_unit, gtin, temperature_condition,
  country_of_origin, co2_per_kg, delivery_reliability, has_image`;

function toSummary(r: ProductRow): ProductSummary {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    vendorName: r.vendor_name,
    category: r.category,
    salesUnit: r.sales_unit,
    gtin: r.gtin,
    temperatureCondition: r.temperature_condition,
    countryOfOrigin: r.country_of_origin,
    co2PerKg: r.co2_per_kg,
    deliveryReliability: r.delivery_reliability,
    hasImage: r.has_image,
  };
}

async function db() {
  await ensureCatalogSchema();
  return getPool();
}

// ---------- Products ----------

export async function searchProducts(query: ProductSearchQuery): Promise<ProductSearchResponse> {
  const pool = await db();
  const where: string[] = [];
  const params: unknown[] = [];
  for (const word of (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
    // Escape LIKE wildcards so "50%" matches literally.
    params.push(`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`search_text LIKE $${params.length}`);
  }
  if (query.category) {
    params.push(query.category);
    where.push(`category = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM valio_product ${whereSql}`, params),
    pool.query<ProductRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM valio_product ${whereSql}
       ORDER BY name, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, query.offset],
    ),
  ]);
  return { total: countRows[0]?.total ?? 0, items: rows.map(toSummary) };
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const pool = await db();
  const { rows } = await pool.query<ProductRow>("SELECT * FROM valio_product WHERE id = $1", [id]);
  const r = rows[0];
  if (!r) return null;

  const [{ rows: units }, { rows: substitutes }] = await Promise.all([
    pool.query<ProductUnitRow>(
      "SELECT * FROM valio_product_unit WHERE product_id = $1 ORDER BY size_in_base_units",
      [id],
    ),
    pool.query<ProductRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM valio_product
       WHERE id IN (SELECT substitute_id FROM valio_product_substitute WHERE product_id = $1)
       ORDER BY name`,
      [id],
    ),
  ]);

  return {
    ...toSummary(r),
    names: { en: r.name, fi: r.name_fi, sv: r.name_sv },
    baseUnit: r.base_unit,
    allowedLotSize: r.allowed_lot_size,
    units: units.map((u) => ({ unitId: u.unit_id, gtin: u.gtin, sizeInBaseUnits: u.size_in_base_units })),
    allergens: r.allergens,
    storageTempC:
      r.storage_temp_min === null && r.storage_temp_max === null
        ? null
        : { min: r.storage_temp_min, max: r.storage_temp_max },
    netWeightKg: r.net_weight_kg,
    co2PerBaseUnit: r.co2_per_base_unit,
    vatCode: r.vat_code,
    substitutes: substitutes.map(toSummary),
  };
}

/** Splits requested ids into known products (with their sales unit) and unknown codes. */
async function knownProducts(ids: string[]) {
  const pool = await db();
  const unique = [...new Set(ids)];
  const { rows } = await pool.query<{ id: string; sales_unit: string }>(
    "SELECT id, sales_unit FROM valio_product WHERE id = ANY($1)",
    [unique],
  );
  const salesUnits = new Map(rows.map((r) => [r.id, r.sales_unit]));
  return {
    pool,
    known: unique.filter((id) => salesUnits.has(id)),
    unknown: unique.filter((id) => !salesUnits.has(id)),
    salesUnits,
  };
}

// ---------- Prices ----------

const PRICE_SELECT = `SELECT DISTINCT ON (product_id) product_id, pricing_date::text AS pricing_date, fetched_at,
  source, currency, price_excl_vat, price_incl_vat, vat_rate, list_price_excl_vat, comparison_price,
  comparison_unit, customer_price, valid_from, valid_to, error
  FROM valio_price_snapshot`;

export async function getPrices({ productIds, date }: PricesRequest): Promise<PricesResponse> {
  const { pool, known, unknown, salesUnits } = await knownProducts(productIds);
  const source = valioSource();

  // Fresh snapshots from the same source are reused; the rest is fetched from Valio.
  const { rows: cached } = await pool.query<PriceSnapshotRow>(
    `${PRICE_SELECT}
     WHERE product_id = ANY($1) AND pricing_date = $2 AND source = $3
       AND fetched_at > now() - make_interval(mins => $4)
     ORDER BY product_id, fetched_at DESC`,
    [known, date, source, CACHE_MINUTES],
  );
  const missing = known.filter((id) => !cached.some((r) => r.product_id === id));
  const fetched = await fetchPrices(missing, date);

  let inserted: PriceSnapshotRow[] = [];
  if (fetched.length > 0) {
    const { rows } = await pool.query<PriceSnapshotRow>(
      `INSERT INTO valio_price_snapshot (product_id, pricing_date, source, currency, price_excl_vat,
         price_incl_vat, vat_rate, list_price_excl_vat, comparison_price, comparison_unit,
         customer_price, valid_from, valid_to, error)
       SELECT * FROM unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::float8[], $6::float8[],
         $7::float8[], $8::float8[], $9::float8[], $10::text[], $11::bool[], $12::text[], $13::text[], $14::bool[])
       RETURNING product_id, pricing_date::text AS pricing_date, fetched_at, source, currency,
         price_excl_vat, price_incl_vat, vat_rate, list_price_excl_vat, comparison_price,
         comparison_unit, customer_price, valid_from, valid_to, error`,
      [
        fetched.map((p) => p.productId),
        fetched.map(() => date),
        fetched.map(() => source),
        fetched.map((p) => p.catalogPrice?.currency ?? p.priceWithTax?.currency ?? null),
        fetched.map((p) => (p.error ? null : (p.catalogPrice?.value ?? null))),
        fetched.map((p) => (p.error ? null : (p.priceWithTax?.value ?? p.catalogPrice?.valueWithTax ?? null))),
        fetched.map((p) => p.tax?.taxRate ?? null),
        fetched.map((p) => p.listPrice?.value ?? null),
        fetched.map((p) => p.comparisonPrice?.value ?? null),
        fetched.map((p) => p.comparisonUnit ?? null),
        fetched.map((p) => p.netPriceFound),
        fetched.map((p) => p.catalogPrice?.validFrom ?? p.priceWithTax?.validFrom ?? null),
        fetched.map((p) => p.catalogPrice?.validTo ?? p.priceWithTax?.validTo ?? null),
        fetched.map((p) => p.error),
      ],
    );
    inserted = rows;
  }

  const byId = new Map([...cached, ...inserted].map((r) => [r.product_id, r]));
  const quotes: PriceQuote[] = known.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return []; // Valio returned nothing for it: leave it out rather than invent a price.
    const found = !r.error && r.price_excl_vat !== null;
    return [
      {
        productId: id,
        found,
        salesUnit: salesUnits.get(id)!,
        priceExclVat: found ? r.price_excl_vat : null,
        priceInclVat: found ? r.price_incl_vat : null,
        vatRatePct: r.vat_rate,
        listPriceExclVat: r.list_price_excl_vat,
        customerPrice: r.customer_price,
        comparisonPrice: r.comparison_price,
        comparisonUnit: r.comparison_unit,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        fetchedAt: r.fetched_at.toISOString(),
      },
    ];
  });

  const currency = [...byId.values()].find((r) => r.currency)?.currency ?? "EUR";
  return { pricingDate: date, currency, source, quotes, unknownProductIds: unknown };
}

// ---------- Availability ----------

const AVAILABILITY_SELECT = `SELECT DISTINCT ON (product_id) product_id, requested_date::text AS requested_date,
  fetched_at, source, sales_block, logistic_model, closing_time, available_amount, available_date, sales_unit
  FROM valio_availability_snapshot`;

function toLogisticModel(value: string | null): Availability["logisticModel"] {
  const v = value?.toLowerCase();
  return v === "stock" || v === "terminal" ? v : null;
}

export async function getAvailability({ productIds, date }: AvailabilityRequest): Promise<AvailabilityResponse> {
  const { pool, known, unknown } = await knownProducts(productIds);
  const source = valioSource();

  const { rows: cached } = await pool.query<AvailabilitySnapshotRow>(
    `${AVAILABILITY_SELECT}
     WHERE product_id = ANY($1) AND requested_date = $2 AND source = $3
       AND fetched_at > now() - make_interval(mins => $4)
     ORDER BY product_id, fetched_at DESC`,
    [known, date, source, CACHE_MINUTES],
  );
  const missing = known.filter((id) => !cached.some((r) => r.product_id === id));
  const fetched = await fetchAvailability(missing, date);

  let inserted: AvailabilitySnapshotRow[] = [];
  if (fetched.length > 0) {
    // Valio sends at most one schedule line; no line = not deliverable on any date.
    const line = (i: number) => fetched[i]!.scheduleLines[0];
    const { rows } = await pool.query<AvailabilitySnapshotRow>(
      `INSERT INTO valio_availability_snapshot (product_id, requested_date, source, sales_block,
         logistic_model, closing_time, available_amount, available_date, sales_unit)
       SELECT * FROM unnest($1::text[], $2::date[], $3::text[], $4::bool[], $5::text[], $6::text[],
         $7::float8[], $8::text[], $9::text[])
       RETURNING product_id, requested_date::text AS requested_date, fetched_at, source, sales_block,
         logistic_model, closing_time, available_amount, available_date, sales_unit`,
      [
        fetched.map((a) => a.productId),
        fetched.map(() => date),
        fetched.map(() => source),
        fetched.map((a, i) => a.salesBlock || (line(i)?.salesBlock ?? false)),
        fetched.map((a) => a.logisticModel ?? null),
        fetched.map((a) => a.closingTime ?? null),
        fetched.map((_, i) => line(i)?.availableAmount ?? null),
        fetched.map((_, i) => line(i)?.availableDate ?? null),
        fetched.map((_, i) => line(i)?.salesUnit ?? null),
      ],
    );
    inserted = rows;
  }

  const byId = new Map([...cached, ...inserted].map((r) => [r.product_id, r]));
  const items: Availability[] = known.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const amount = r.available_amount;
    const unknownAmount = amount === VALIO_UNKNOWN_AMOUNT;
    return [
      {
        productId: id,
        orderable: !r.sales_block && amount !== null && amount > 0,
        salesBlock: r.sales_block,
        logisticModel: toLogisticModel(r.logistic_model),
        availableQuantity: amount === null || unknownAmount ? null : amount,
        availableDate: r.available_date,
        orderCutoff: r.closing_time,
        salesUnit: r.sales_unit,
        fetchedAt: r.fetched_at.toISOString(),
      },
    ];
  });

  return { requestedDate: date, source, items, unknownProductIds: unknown };
}
