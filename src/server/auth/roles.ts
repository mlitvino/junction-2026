import "server-only";

import type { PoolClient } from "pg";

import { getPool } from "@/server/db/pool";
import type { Organization, Role } from "@/shared/contracts/me";

import { ensureOrganizationSchema } from "./organization-schema";

// Roles are per organization; a user can hold several:
// - buyer: searches products and places orders
// - approver: approves buyers' orders, sets the organization's AI settings and manages its members
// Guard routes with requireRole() from server/api/middleware/session.ts.

/** Roles a self-signed-up user gets in the organization created for them. */
export const FOUNDER_ROLES: Role[] = ["buyer", "approver"];

export type Membership = { organization: Organization; roles: Role[] };

export function hasRole(user: { roles: Role[] }, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

/** Stable order (buyer, approver) so responses don't depend on insert order. */
export function sortRoles(roles: Iterable<string>): Role[] {
  const set = new Set(roles);
  return FOUNDER_ROLES.filter((r) => set.has(r));
}

async function findMembership(db: { query: PoolClient["query"] }, userId: string): Promise<Membership | null> {
  const { rows } = await db.query<{ id: string; name: string; roles: string[] }>(
    `SELECT o.id, o.name, m.roles FROM organization_member m
     JOIN organization o ON o.id = m.organization_id WHERE m.user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return r ? { organization: { id: r.id, name: r.name }, roles: sortRoles(r.roles) } : null;
}

/**
 * The user's organization and roles. A user without one (fresh self sign-up, or an account from
 * before organizations existed) gets their own organization as buyer + approver.
 * Accounts created by an approver always have a membership, so they never get one of their own.
 */
export async function getOrCreateMembership(userId: string, username: string): Promise<Membership> {
  await ensureOrganizationSchema();
  const pool = getPool();
  const existing = await findMembership(pool, userId);
  if (existing) return existing;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO organization (name) VALUES ($1) RETURNING id",
      [`${username}'s organization`],
    );
    const inserted = await client.query(
      `INSERT INTO organization_member (organization_id, user_id, roles) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [rows[0]!.id, userId, FOUNDER_ROLES],
    );
    // A parallel first request already created the membership: drop our organization, use theirs.
    await client.query(inserted.rowCount === 1 ? "COMMIT" : "ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const membership = await findMembership(pool, userId);
  if (!membership) throw new Error(`No organization for user ${userId} after creating one`);
  return membership;
}
