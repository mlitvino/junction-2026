import "server-only";

import { eq, TransactionRollbackError } from "drizzle-orm";

import { getDb, type Db } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { organization, organizationMember } from "@/server/db/schema";
import type { Organization, Role } from "@/shared/contracts/me";

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

async function findMembership(db: Db, userId: string): Promise<Membership | null> {
  const [row] = await db
    .select({ id: organization.id, name: organization.name, roles: organizationMember.roles })
    .from(organizationMember)
    .innerJoin(organization, eq(organization.id, organizationMember.organizationId))
    .where(eq(organizationMember.userId, userId));
  return row ? { organization: { id: row.id, name: row.name }, roles: sortRoles(row.roles) } : null;
}

/**
 * The user's organization and roles. A user without one (fresh self sign-up, or an account from
 * before organizations existed) gets their own organization as buyer + approver.
 * Accounts created by an approver always have a membership, so they never get one of their own.
 */
export async function getOrCreateMembership(userId: string, username: string): Promise<Membership> {
  await ensureDatabase();
  const db = getDb();
  const existing = await findMembership(db, userId);
  if (existing) return existing;

  await db
    .transaction(async (tx) => {
      const [org] = await tx
        .insert(organization)
        .values({ name: `${username}'s organization` })
        .returning({ id: organization.id });
      const inserted = await tx
        .insert(organizationMember)
        .values({ organizationId: org!.id, userId, roles: FOUNDER_ROLES })
        .onConflictDoNothing({ target: organizationMember.userId })
        .returning({ userId: organizationMember.userId });
      // A parallel first request already created the membership: drop our organization, use theirs.
      if (inserted.length === 0) tx.rollback();
    })
    .catch((err: unknown) => {
      // tx.rollback() throws on purpose; anything else is a real error.
      if (!(err instanceof TransactionRollbackError)) throw err;
    });

  const membership = await findMembership(db, userId);
  if (!membership) throw new Error(`No organization for user ${userId} after creating one`);
  return membership;
}
