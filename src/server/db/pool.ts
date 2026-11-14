import "server-only";
import { Pool } from "pg";

// One pool per process. Cached on globalThis so Next.js dev hot reloads don't leak connections.
const globalForPool = globalThis as typeof globalThis & { __pgPool?: Pool };

/** Lazy on purpose: importing this file must not need DATABASE_URL (e.g. during `next build`). */
export function getPool(): Pool {
  if (!globalForPool.__pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env (see compose.dev.yml).",
      );
    }
    globalForPool.__pgPool = new Pool({ connectionString });
  }
  return globalForPool.__pgPool;
}
