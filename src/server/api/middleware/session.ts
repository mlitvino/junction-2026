import "server-only";

import { createMiddleware } from "hono/factory";

import { getSessionUser } from "@/server/auth/session";
import type { Role, SessionUser } from "@/shared/contracts/me";

import type { ApiEnv } from "../router";

/** The user an earlier middleware (default-deny in app.ts) already resolved for this request. */
function sessionUserOf(c: { get: (key: "user") => SessionUser | undefined }): SessionUser | undefined {
  return c.get("user");
}

/**
 * Session check. app.ts runs it on every non-public route (default-deny); routers may add it too.
 * No valid session → 401; otherwise the user (with organization and roles) is `c.var.user`.
 */
export const requireSession = createMiddleware<ApiEnv>(async (c, next) => {
  const user = sessionUserOf(c) ?? (await getSessionUser(c.req.raw.headers));
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
    const user = sessionUserOf(c) ?? (await getSessionUser(c.req.raw.headers));
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (!roles.some((r) => user.roles.includes(r))) return c.json({ error: "Forbidden" }, 403);

    c.set("user", user);
    return next();
  });
}
