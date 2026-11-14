import "server-only";

import { getPool } from "@/server/db/pool";

import { ensureAuthSchema } from "./migrate";

// Organizations and per-organization roles. Our own tables (not Better Auth's organization plugin,
// which would expose its own /api/auth/organization/* endpoints with its own permission rules).
// One organization per user (UNIQUE user_id). Additive only, like every schema here.

const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS organization (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_member (
  organization_id text NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  user_id         text NOT NULL UNIQUE REFERENCES "user" (id) ON DELETE CASCADE,
  roles           text[] NOT NULL
                  CHECK (roles <@ ARRAY['buyer', 'approver'] AND cardinality(roles) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
`;

let ready: Promise<void> | undefined;

/** Creates the organization tables once per process, after Better Auth's (FK to "user"). */
export function ensureOrganizationSchema(): Promise<void> {
  ready ??= (async () => {
    await ensureAuthSchema();
    await getPool().query(DDL);
  })().catch((err: unknown) => {
    ready = undefined;
    throw err;
  });
  return ready;
}
