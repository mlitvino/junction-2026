// Applies pending Drizzle migrations (drizzle/) to DATABASE_URL. The app also does this by itself on
// first use (ensureDatabase); this is for applying them explicitly, e.g. before an import or on a server.
// Run: pnpm db:migrate

import { ensureDatabase } from "../src/server/db/migrate.ts";
import { getPool } from "../src/server/db/pool.ts";

try {
  await ensureDatabase();
  console.log("Database is up to date.");
} finally {
  await getPool().end();
}
