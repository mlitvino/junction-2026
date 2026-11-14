import "server-only";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { SessionUser } from "@/shared/contracts/me";

/**
 * `user` is set by the session middleware on every non-public route (default-deny),
 * so private handlers can rely on `c.var.user`. Public routes must not read it.
 */
export type ApiEnv = { Variables: { user: SessionUser } };

/**
 * Every route module creates its router here, so all endpoints share the same
 * validation error shape: invalid input → 400 `{ error: ZodIssue[] }`.
 */
export function createRouter() {
  return new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.issues }, 400);
      }
    },
  });
}
