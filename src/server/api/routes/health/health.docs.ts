import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { HealthResponseSchema } from "@/shared/contracts/health";

// OpenAPI definitions for the health routes. Handlers live in ./health.ts.

export const getHealthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Health check",
  description: "Returns `ok` and the server time. No authentication.",
  responses: {
    200: {
      description: "The API is up.",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});
