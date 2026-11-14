// Parses data/valio/* (pnpm data:fetch first) and loads it into Postgres (pnpm db:up first).
// Run: pnpm data:import. Idempotent: run again after new files arrive.

import { importCatalog } from "../src/server/catalog/import.ts";
import { loadValioCatalog } from "../src/server/catalog/valio-data.ts";
import { getPool } from "../src/server/db/pool.ts";

const started = performance.now();
try {
  const catalog = await loadValioCatalog();
  const result = await importCatalog(catalog);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `Imported ${result.products} products, ${result.units} units, ${result.substitutes} substitutes in ${seconds}s` +
      (catalog.issues.length ? ` (${catalog.issues.length} data issues, see pnpm data:analyze)` : ""),
  );
} finally {
  await getPool().end();
}
