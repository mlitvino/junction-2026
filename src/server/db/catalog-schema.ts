import "server-only";

import { getPool } from "./pool.ts";

// Postgres tables for the Valio catalog. Created on first use (like Better Auth's tables in
// server/auth/migrate.ts) and by `pnpm data:import`. Additive only: never drop or rename here,
// add new columns with `ADD COLUMN IF NOT EXISTS`, so an older image still works after a rollback.
// Numbers are double precision (pg returns numeric as strings); dates are selected as text.

const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS valio_product (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  name_fi               text,
  name_sv               text,
  brand                 text,
  vendor_name           text NOT NULL,
  category              text NOT NULL,
  sales_unit            text NOT NULL,
  base_unit             text NOT NULL,
  gtin                  text,
  synkka_gtin           text,
  allowed_lot_size      double precision NOT NULL,
  temperature_condition integer,
  storage_temp_min      double precision,
  storage_temp_max      double precision,
  country_of_origin     text,
  vat_code              text,
  variable_weight       boolean,
  net_weight_kg         double precision,
  co2_per_kg            double precision,
  co2_per_base_unit     double precision,
  delivery_reliability  double precision,
  has_image             boolean NOT NULL DEFAULT false,
  allergens             text[] NOT NULL DEFAULT '{}',
  synkka_updated_at     timestamptz,
  -- Lowercased names (en/fi/sv) + brand + vendor + id + GTINs, matched with ILIKE by the search.
  search_text           text NOT NULL,
  imported_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS valio_product_category_idx ON valio_product (category);

CREATE TABLE IF NOT EXISTS valio_product_unit (
  product_id         text NOT NULL REFERENCES valio_product (id) ON DELETE CASCADE,
  unit_id            text NOT NULL,
  gtin               text,
  size_in_base_units double precision NOT NULL,
  PRIMARY KEY (product_id, unit_id)
);

CREATE TABLE IF NOT EXISTS valio_product_substitute (
  product_id    text NOT NULL REFERENCES valio_product (id) ON DELETE CASCADE,
  substitute_id text NOT NULL,
  PRIMARY KEY (product_id, substitute_id)
);

-- Insert-only log of every price we fetched: the audit trail ("price X seen at T") and a short cache.
CREATE TABLE IF NOT EXISTS valio_price_snapshot (
  id                  bigserial PRIMARY KEY,
  product_id          text NOT NULL,
  pricing_date        date NOT NULL,
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  source              text NOT NULL,
  currency            text,
  price_excl_vat      double precision,
  price_incl_vat      double precision,
  vat_rate            double precision,
  list_price_excl_vat double precision,
  comparison_price    double precision,
  comparison_unit     text,
  customer_price      boolean NOT NULL,
  valid_from          text,
  valid_to            text,
  error               boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS valio_price_snapshot_lookup_idx
  ON valio_price_snapshot (product_id, pricing_date, fetched_at DESC);

-- Insert-only log of every availability answer we fetched.
CREATE TABLE IF NOT EXISTS valio_availability_snapshot (
  id               bigserial PRIMARY KEY,
  product_id       text NOT NULL,
  requested_date   date NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL,
  sales_block      boolean NOT NULL,
  logistic_model   text,
  closing_time     text,
  available_amount double precision,
  available_date   text,
  sales_unit       text
);
CREATE INDEX IF NOT EXISTS valio_availability_snapshot_lookup_idx
  ON valio_availability_snapshot (product_id, requested_date, fetched_at DESC);
`;

// Trigram index makes ILIKE '%word%' fast. Optional: needs the pg_trgm extension (bundled with the
// pgvector image); without it search still works with a sequential scan over ~17.5k rows.
const TRIGRAM = /* sql */ `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS valio_product_search_trgm_idx
  ON valio_product USING gin (search_text gin_trgm_ops);
`;

let ready: Promise<void> | undefined;

/** Creates the catalog tables once per process. A failure is retried on the next call. */
export function ensureCatalogSchema(): Promise<void> {
  ready ??= (async () => {
    const pool = getPool();
    await pool.query(DDL);
    try {
      await pool.query(TRIGRAM);
    } catch (err) {
      console.warn("pg_trgm unavailable, catalog search runs without a trigram index:", err);
    }
  })().catch((err: unknown) => {
    ready = undefined;
    throw err;
  });
  return ready;
}

// ---------- Row types (as selected by the catalog service) ----------

export type ProductRow = {
  id: string;
  name: string;
  name_fi: string | null;
  name_sv: string | null;
  brand: string | null;
  vendor_name: string;
  category: string;
  sales_unit: string;
  base_unit: string;
  gtin: string | null;
  synkka_gtin: string | null;
  allowed_lot_size: number;
  temperature_condition: number | null;
  storage_temp_min: number | null;
  storage_temp_max: number | null;
  country_of_origin: string | null;
  vat_code: string | null;
  variable_weight: boolean | null;
  net_weight_kg: number | null;
  co2_per_kg: number | null;
  co2_per_base_unit: number | null;
  delivery_reliability: number | null;
  has_image: boolean;
  allergens: string[];
};

export type ProductUnitRow = {
  product_id: string;
  unit_id: string;
  gtin: string | null;
  size_in_base_units: number;
};

export type PriceSnapshotRow = {
  product_id: string;
  /** YYYY-MM-DD (selected as text). */
  pricing_date: string;
  fetched_at: Date;
  source: string;
  currency: string | null;
  price_excl_vat: number | null;
  price_incl_vat: number | null;
  vat_rate: number | null;
  list_price_excl_vat: number | null;
  comparison_price: number | null;
  comparison_unit: string | null;
  customer_price: boolean;
  valid_from: string | null;
  valid_to: string | null;
  error: boolean;
};

export type AvailabilitySnapshotRow = {
  product_id: string;
  /** YYYY-MM-DD (selected as text). */
  requested_date: string;
  fetched_at: Date;
  source: string;
  sales_block: boolean;
  logistic_model: string | null;
  closing_time: string | null;
  available_amount: number | null;
  available_date: string | null;
  sales_unit: string | null;
};
