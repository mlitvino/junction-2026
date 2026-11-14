import "server-only";

import { APIError } from "better-auth/api";

import { getAuth } from "@/server/auth/auth";
import { ensureOrganizationSchema } from "@/server/auth/organization-schema";
import { sortRoles } from "@/server/auth/roles";
import { getPool } from "@/server/db/pool";
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

type MemberRow = { user_id: string; username: string; roles: string[] };

const toMember = (r: MemberRow): Member => ({ userId: r.user_id, username: r.username, roles: sortRoles(r.roles) });

const MEMBER_SELECT = `SELECT m.user_id, coalesce(u.username, u.name) AS username, m.roles
  FROM organization_member m JOIN "user" u ON u.id = m.user_id`;

export async function listMembers(organizationId: string): Promise<Member[]> {
  await ensureOrganizationSchema();
  const { rows } = await getPool().query<MemberRow>(
    `${MEMBER_SELECT} WHERE m.organization_id = $1 ORDER BY username`,
    [organizationId],
  );
  return rows.map(toMember);
}

/** Creates a login (username + password) that belongs to `organizationId` with the given roles. */
export async function createMember(organizationId: string, input: CreateMemberRequest): Promise<Member> {
  await ensureOrganizationSchema();
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

  try {
    await getPool().query(
      "INSERT INTO organization_member (organization_id, user_id, roles) VALUES ($1, $2, $3)",
      [organizationId, userId, sortRoles(input.roles)],
    );
  } catch (err) {
    // Without a membership the account would get an organization of its own on first sign-in.
    await getPool().query('DELETE FROM "user" WHERE id = $1', [userId]);
    throw err;
  }
  return { userId, username: login, roles: sortRoles(input.roles) };
}

/** Replaces a member's roles. Refuses to leave the organization without an approver. */
export async function updateMemberRoles(organizationId: string, userId: string, roles: Role[]): Promise<Member> {
  await ensureOrganizationSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Lock the organization's members so two approvers can't demote each other at the same time.
    const { rows } = await client.query<{ user_id: string; roles: string[] }>(
      "SELECT user_id, roles FROM organization_member WHERE organization_id = $1 FOR UPDATE",
      [organizationId],
    );
    if (!rows.some((r) => r.user_id === userId)) {
      throw new OrganizationError(404, "No such member in your organization");
    }
    const approversAfter = rows.filter((r) =>
      r.user_id === userId ? roles.includes("approver") : r.roles.includes("approver"),
    ).length;
    if (approversAfter === 0) {
      throw new OrganizationError(409, "The organization must keep at least one approver");
    }
    await client.query("UPDATE organization_member SET roles = $1 WHERE organization_id = $2 AND user_id = $3", [
      sortRoles(roles),
      organizationId,
      userId,
    ]);
    const { rows: updated } = await client.query<MemberRow>(
      `${MEMBER_SELECT} WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    await client.query("COMMIT");
    return toMember(updated[0]!);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
