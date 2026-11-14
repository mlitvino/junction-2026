import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";

import { getAuth } from "@/server/auth/auth";
import { sortRoles } from "@/server/auth/roles";
import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { organizationMember, user } from "@/server/db/schema";
import type { Role } from "@/shared/contracts/me";
import type { CreateMemberRequest, Member } from "@/shared/contracts/organization";

// Member management for one organization. Every function takes the caller's organization id, so an
// approver can only ever see and change their own organization.

/** Expected failures, mapped to HTTP statuses by the route. */
export class OrganizationError extends Error {
  readonly status: 404 | 409;
  constructor(status: 404 | 409, message: string) {
    super(message);
    this.name = "OrganizationError";
    this.status = status;
  }
}

const memberColumns = {
  userId: organizationMember.userId,
  username: sql<string>`coalesce(${user.username}, ${user.name})`,
  roles: organizationMember.roles,
};

const toMember = (r: { userId: string; username: string; roles: string[] }): Member => ({
  userId: r.userId,
  username: r.username,
  roles: sortRoles(r.roles),
});

export async function listMembers(organizationId: string): Promise<Member[]> {
  await ensureDatabase();
  const rows = await getDb()
    .select(memberColumns)
    .from(organizationMember)
    .innerJoin(user, eq(user.id, organizationMember.userId))
    .where(eq(organizationMember.organizationId, organizationId))
    .orderBy(asc(memberColumns.username));
  return rows.map(toMember);
}

/** Creates a login (username + password) that belongs to `organizationId` with the given roles. */
export async function createMember(organizationId: string, input: CreateMemberRequest): Promise<Member> {
  await ensureDatabase();
  const login = input.username.toLowerCase();

  let userId: string;
  try {
    // Same shape as the frontend sign-up (src/client/auth-client.ts): Better Auth needs an email.
    const result = await getAuth().api.signUpEmail({
      body: { email: `${login}@users.invalid`, name: login, username: login, password: input.password },
    });
    userId = result.user.id;
  } catch (err) {
    if (err instanceof APIError && /already|taken|exists/i.test(err.message)) {
      throw new OrganizationError(409, "Username is already taken");
    }
    throw err;
  }

  const db = getDb();
  try {
    await db.insert(organizationMember).values({ organizationId, userId, roles: sortRoles(input.roles) });
  } catch (err) {
    // Without a membership the account would get an organization of its own on first sign-in.
    await db.delete(user).where(eq(user.id, userId));
    throw err;
  }
  return { userId, username: login, roles: sortRoles(input.roles) };
}

/** Replaces a member's roles. Refuses to leave the organization without an approver. */
export async function updateMemberRoles(organizationId: string, userId: string, roles: Role[]): Promise<Member> {
  await ensureDatabase();
  return getDb().transaction(async (tx) => {
    // Lock the organization's members so two approvers can't demote each other at the same time.
    const members = await tx
      .select({ userId: organizationMember.userId, roles: organizationMember.roles })
      .from(organizationMember)
      .where(eq(organizationMember.organizationId, organizationId))
      .for("update");
    if (!members.some((m) => m.userId === userId)) {
      throw new OrganizationError(404, "No such member in your organization");
    }
    const approversAfter = members.filter((m) =>
      m.userId === userId ? roles.includes("approver") : m.roles.includes("approver"),
    ).length;
    if (approversAfter === 0) {
      throw new OrganizationError(409, "The organization must keep at least one approver");
    }

    const memberOf = and(eq(organizationMember.organizationId, organizationId), eq(organizationMember.userId, userId));
    await tx.update(organizationMember).set({ roles: sortRoles(roles) }).where(memberOf);
    const [updated] = await tx
      .select(memberColumns)
      .from(organizationMember)
      .innerJoin(user, eq(user.id, organizationMember.userId))
      .where(memberOf);
    return toMember(updated!);
  });
}
