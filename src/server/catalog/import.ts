import "server-only";

import { getTableColumns, inArray, sql, type SQL } from "drizzle-orm";

import { getDb } from "../db/client.ts";
import { ensureDatabase } from "../db/migrate.ts";
import { valioProduct, valioProductSubstitute, valioProductUnit } from "../db/schema/index.ts";
import type { CatalogProduct, ValioCatalog } from "./valio-data.ts";

// Loads the parsed static catalog into Postgres (pnpm data:import). Idempotent: products are
// upserted, their units and substitutes replaced, all in one transaction.

const BATCH_SIZE = 500;

type ProductInsert = typeof valioProduct.$inferInsert;

function searchText(p: CatalogProduct): string {
  return [p.name, p.names.fi, p.names.sv, p.brand, p.vendorName, p.id, p.gtin, p.synkkaGtin]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function productRow(p: CatalogProduct): ProductInsert {
  return {
    id: p.id,
    name: p.name,
    nameFi: p.names.fi ?? null,
    nameSv: p.names.sv ?? null,
    brand: p.brand,
    vendorName: p.vendorName,
    category: p.category,
    salesUnit: p.salesUnit,
    baseUnit: p.baseUnit,
    gtin: p.gtin,
    synkkaGtin: p.synkkaGtin,
    allowedLotSize: p.allowedLotSize,
    temperatureCondition: p.temperatureCondition,
    storageTempMin: p.storageTempC?.min ?? null,
    storageTempMax: p.storageTempC?.max ?? null,
    countryOfOrigin: p.countryOfOrigin,
    vatCode: p.vatCode,
    variableWeight: p.variableWeight,
    netWeightKg: p.netWeightKg,
    co2PerKg: p.co2PerKg,
    co2PerBaseUnit: p.co2PerBaseUnit,
    deliveryReliability: p.deliveryReliability,
    hasImage: p.hasImage,
    allergens: p.allergens,
    synkkaUpdatedAt: p.synkkaLastUpdated ? new Date(p.synkkaLastUpdated) : null,
    searchText: searchText(p),
  };
}

/** `SET col = EXCLUDED.col` for every product column except the key, plus a fresh imported_at. */
function upsertSet(): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(valioProduct))) {
    if (key === "id") continue;
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  set.importedAt = sql`now()`;
  return set;
}

export type ImportResult = { products: number; units: number; substitutes: number };

export async function importCatalog(catalog: ValioCatalog): Promise<ImportResult> {
  await ensureDatabase();
  const products = [...catalog.products.values()];
  const result: ImportResult = { products: 0, units: 0, substitutes: 0 };
  const set = upsertSet();

  await getDb().transaction(async (tx) => {
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const ids = batch.map((p) => p.id);

      await tx
        .insert(valioProduct)
        .values(batch.map(productRow))
        .onConflictDoUpdate({ target: valioProduct.id, set });
      result.products += batch.length;

      // Child rows: replace, so units/substitutes removed from the file disappear too.
      await tx.delete(valioProductUnit).where(inArray(valioProductUnit.productId, ids));
      await tx.delete(valioProductSubstitute).where(inArray(valioProductSubstitute.productId, ids));

      // A product can list the same unit twice; keep the first so the primary key holds.
      const units = batch.flatMap((p) => {
        const seen = new Set<string>();
        return p.units
          .filter((u) => !seen.has(u.unitId) && seen.add(u.unitId))
          .map((u) => ({ productId: p.id, unitId: u.unitId, gtin: u.gtin, sizeInBaseUnits: u.sizeInBaseUnits }));
      });
      if (units.length) await tx.insert(valioProductUnit).values(units);
      result.units += units.length;

      const substitutes = batch.flatMap((p) =>
        [...new Set(p.substitutes)].map((substituteId) => ({ productId: p.id, substituteId })),
      );
      if (substitutes.length) await tx.insert(valioProductSubstitute).values(substitutes);
      result.substitutes += substitutes.length;
    }
  });
  return result;
}
