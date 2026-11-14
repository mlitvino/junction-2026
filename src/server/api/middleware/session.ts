import "server-only";

import { createMiddleware } from "hono/factory";

import { getSessionUser } from "@/server/auth/session";
import type { Role } from "@/shared/contracts/me";

import type { ApiEnv } from "../router";

/**
 * Opt-in session check: the API is open by default (for now). Add this to a router only for
 * endpoints that need the signed-in user, e.g. `createRouter().use("/me", requireSession)`.
 * No valid session → 401; otherwise the user (with organization and roles) is `c.var.user`.
 */
export const requireSession = createMiddleware<ApiEnv>(async (c, next) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  c.set("user", user);
  return next();
});

/**
 * Like requireSession, but the user must also hold at least one of `roles` in their organization:
 * no session → 401, none of the roles → 403. Example: `router.use("/organization/*", requireRole("approver"))`.
 * Data is still per organization: handlers must scope queries to `c.var.user.organization.id`.
 */
export function requireRole(...roles: Role[]) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const user = await getSessionUser(c.req.raw.headers);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (!roles.some((r) => user.roles.includes(r))) return c.json({ error: "Forbidden" }, 403);

    c.set("user", user);
    return next();
  });
}
