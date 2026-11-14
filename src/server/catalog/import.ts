import "server-only";

import type { PoolClient } from "pg";

import { ensureCatalogSchema } from "../db/catalog-schema.ts";
import { getPool } from "../db/pool.ts";
import type { CatalogProduct, ValioCatalog } from "./valio-data.ts";

// Loads the parsed static catalog into Postgres (pnpm data:import). Idempotent: products are
// upserted, their units and substitutes replaced, all in one transaction.

const BATCH_SIZE = 500;

function searchText(p: CatalogProduct): string {
  return [p.name, p.names.fi, p.names.sv, p.brand, p.vendorName, p.id, p.gtin, p.synkkaGtin]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Multi-row INSERT with numbered placeholders: rows × columns values. */
async function insertRows(
  client: PoolClient,
  head: string,
  columns: number,
  rows: unknown[][],
  tail = "",
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map((_, r) => `(${Array.from({ length: columns }, (_, c) => `$${r * columns + c + 1}`).join(", ")})`)
    .join(", ");
  await client.query(`${head} VALUES ${placeholders} ${tail}`, rows.flat());
}

const PRODUCT_COLUMNS = [
  "id", "name", "name_fi", "name_sv", "brand", "vendor_name", "category", "sales_unit", "base_unit",
  "gtin", "synkka_gtin", "allowed_lot_size", "temperature_condition", "storage_temp_min",
  "storage_temp_max", "country_of_origin", "vat_code", "variable_weight", "net_weight_kg",
  "co2_per_kg", "co2_per_base_unit", "delivery_reliability", "has_image", "allergens",
  "synkka_updated_at", "search_text",
] as const;

function productRow(p: CatalogProduct): unknown[] {
  return [
    p.id, p.name, p.names.fi ?? null, p.names.sv ?? null, p.brand, p.vendorName, p.category,
    p.salesUnit, p.baseUnit, p.gtin, p.synkkaGtin, p.allowedLotSize, p.temperatureCondition,
    p.storageTempC?.min ?? null, p.storageTempC?.max ?? null, p.countryOfOrigin, p.vatCode,
    p.variableWeight, p.netWeightKg, p.co2PerKg, p.co2PerBaseUnit, p.deliveryReliability,
    p.hasImage, p.allergens, p.synkkaLastUpdated, searchText(p),
  ];
}

export type ImportResult = { products: number; units: number; substitutes: number };

export async function importCatalog(catalog: ValioCatalog): Promise<ImportResult> {
  await ensureCatalogSchema();
  const products = [...catalog.products.values()];
  const client = await getPool().connect();
  const result: ImportResult = { products: 0, units: 0, substitutes: 0 };
  try {
    await client.query("BEGIN");
    const update = PRODUCT_COLUMNS.filter((c) => c !== "id")
      .map((c) => `${c} = EXCLUDED.${c}`)
      .concat("imported_at = now()")
      .join(", ");

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const ids = batch.map((p) => p.id);

      await insertRows(
        client,
        `INSERT INTO valio_product (${PRODUCT_COLUMNS.join(", ")})`,
        PRODUCT_COLUMNS.length,
        batch.map(productRow),
        `ON CONFLICT (id) DO UPDATE SET ${update}`,
      );
      result.products += batch.length;

      // Child rows: replace, so units/substitutes removed from the file disappear too.
      await client.query("DELETE FROM valio_product_unit WHERE product_id = ANY($1)", [ids]);
      await client.query("DELETE FROM valio_product_substitute WHERE product_id = ANY($1)", [ids]);

      // A product can list the same unit twice; keep the first so the primary key holds.
      const units = batch.flatMap((p) => {
        const seen = new Set<string>();
        return p.units
          .filter((u) => !seen.has(u.unitId) && seen.add(u.unitId))
          .map((u) => [p.id, u.unitId, u.gtin, u.sizeInBaseUnits]);
      });
      await insertRows(
        client,
        "INSERT INTO valio_product_unit (product_id, unit_id, gtin, size_in_base_units)",
        4,
        units,
      );
      result.units += units.length;

      const substitutes = batch.flatMap((p) => [...new Set(p.substitutes)].map((s) => [p.id, s]));
      await insertRows(
        client,
        "INSERT INTO valio_product_substitute (product_id, substitute_id)",
        2,
        substitutes,
      );
      result.substitutes += substitutes.length;
    }
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
