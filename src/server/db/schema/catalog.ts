// No `import "server-only"` here: drizzle-kit loads the schema outside Next.js, where it throws.
// Table definitions only, no secrets.
import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Valio catalog. Static product data is loaded by `pnpm data:import` (server/catalog/import.ts);
// price/availability snapshots are insert-only logs of every live Valio answer (audit trail + cache).
// Numbers are double precision (pg returns numeric as strings); dates are YYYY-MM-DD strings.

const tz = { withTimezone: true } as const;

export const valioProduct = pgTable(
  "valio_product",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameFi: text("name_fi"),
    nameSv: text("name_sv"),
    brand: text("brand"),
    vendorName: text("vendor_name").notNull(),
    category: text("category").notNull(),
    salesUnit: text("sales_unit").notNull(),
    baseUnit: text("base_unit").notNull(),
    gtin: text("gtin"),
    synkkaGtin: text("synkka_gtin"),
    allowedLotSize: doublePrecision("allowed_lot_size").notNull(),
    temperatureCondition: integer("temperature_condition"),
    storageTempMin: doublePrecision("storage_temp_min"),
    storageTempMax: doublePrecision("storage_temp_max"),
    countryOfOrigin: text("country_of_origin"),
    vatCode: text("vat_code"),
    variableWeight: boolean("variable_weight"),
    netWeightKg: doublePrecision("net_weight_kg"),
    co2PerKg: doublePrecision("co2_per_kg"),
    co2PerBaseUnit: doublePrecision("co2_per_base_unit"),
    deliveryReliability: doublePrecision("delivery_reliability"),
    hasImage: boolean("has_image").notNull().default(false),
    allergens: text("allergens").array().notNull().default([]),
    synkkaUpdatedAt: timestamp("synkka_updated_at", tz),
    /** Lowercased names (en/fi/sv) + brand + vendor + id + GTINs, matched with ILIKE by the search. */
    searchText: text("search_text").notNull(),
    importedAt: timestamp("imported_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("valio_product_category_idx").on(t.category),
    // Trigram index makes ILIKE '%word%' fast (pg_trgm extension, created in the migration).
    index("valio_product_search_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
  ],
);

export const valioProductUnit = pgTable(
  "valio_product_unit",
  {
    productId: text("product_id")
      .notNull()
      .references(() => valioProduct.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull(),
    gtin: text("gtin"),
    sizeInBaseUnits: doublePrecision("size_in_base_units").notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.unitId] })],
);

export const valioProductSubstitute = pgTable(
  "valio_product_substitute",
  {
    productId: text("product_id")
      .notNull()
      .references(() => valioProduct.id, { onDelete: "cascade" }),
    substituteId: text("substitute_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.substituteId] })],
);

export const valioPriceSnapshot = pgTable(
  "valio_price_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: text("product_id").notNull(),
    pricingDate: date("pricing_date", { mode: "string" }).notNull(),
    fetchedAt: timestamp("fetched_at", tz).notNull().defaultNow(),
    /** "valio" (live API) or "mock" (no API key). */
    source: text("source").notNull(),
    currency: text("currency"),
    priceExclVat: doublePrecision("price_excl_vat"),
    priceInclVat: doublePrecision("price_incl_vat"),
    vatRate: doublePrecision("vat_rate"),
    listPriceExclVat: doublePrecision("list_price_excl_vat"),
    comparisonPrice: doublePrecision("comparison_price"),
    comparisonUnit: text("comparison_unit"),
    customerPrice: boolean("customer_price").notNull(),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    error: boolean("error").notNull(),
  },
  (t) => [index("valio_price_snapshot_lookup_idx").on(t.productId, t.pricingDate, t.fetchedAt.desc())],
);

export const valioAvailabilitySnapshot = pgTable(
  "valio_availability_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: text("product_id").notNull(),
    requestedDate: date("requested_date", { mode: "string" }).notNull(),
    fetchedAt: timestamp("fetched_at", tz).notNull().defaultNow(),
    source: text("source").notNull(),
    salesBlock: boolean("sales_block").notNull(),
    logisticModel: text("logistic_model"),
    closingTime: text("closing_time"),
    availableAmount: doublePrecision("available_amount"),
    availableDate: text("available_date"),
    salesUnit: text("sales_unit"),
  },
  (t) => [index("valio_availability_snapshot_lookup_idx").on(t.productId, t.requestedDate, t.fetchedAt.desc())],
);

export type ValioProductRow = typeof valioProduct.$inferSelect;
export type ValioPriceSnapshotRow = typeof valioPriceSnapshot.$inferSelect;
export type ValioAvailabilitySnapshotRow = typeof valioAvailabilitySnapshot.$inferSelect;
