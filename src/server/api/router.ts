import "server-only";

import { OpenAPIHono } from "@hono/zod-openapi";

/**
 * Every route module creates its router here, so all endpoints share the same
 * validation error shape: invalid input → 400 `{ error: ZodIssue[] }`.
 */
export function createRouter() {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.issues }, 400);
      }
    },
  });
}
