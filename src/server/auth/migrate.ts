import "server-only";

import { getMigrations } from "better-auth/db/migration";

import { getAuth } from "./auth";

let ready: Promise<void> | undefined;

/**
 * Creates or updates Better Auth's tables (user, session, account, verification) once per process,
 * on first use. Additive only. A failure is retried on the next call.
 */
export function ensureAuthSchema(): Promise<void> {
  ready ??= getMigrations(getAuth().options)
    .then((migrations) => migrations.runMigrations())
    .catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
  return ready;
}
