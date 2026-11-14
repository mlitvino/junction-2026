import "server-only";

import { createMiddleware } from "hono/factory";

import { getSessionUser } from "@/server/auth/session";

import type { ApiEnv } from "../router";

/**
 * Opt-in session check: the API is open by default (for now). Add this to a router only for
 * endpoints that need the signed-in user, e.g. `createRouter().use("/me", requireSession)`.
 * No valid session → 401; otherwise the user is available as `c.var.user`.
 */
export const requireSession = createMiddleware<ApiEnv>(async (c, next) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  c.set("user", user);
  return next();
});
