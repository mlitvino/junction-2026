import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { getPool } from "./pool.ts";
import * as schema from "./schema/index.ts";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & { __db?: Db };

/**
 * The Drizzle client over the shared pg pool. Lazy, like getPool(): importing this file needs no
 * DATABASE_URL (e.g. during `next build`). Call ensureDatabase() (./migrate.ts) before the first query.
 */
export function getDb(): Db {
  globalForDb.__db ??= drizzle(getPool(), { schema });
  return globalForDb.__db;
}
