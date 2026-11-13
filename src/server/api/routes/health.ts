import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { getHealth } from "@/server/services/health";
import { HealthResponseSchema } from "@/shared/contracts/health";

import { createRouter } from "../router";

const getHealthRoute = createRoute({
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

export const healthRouter = createRouter().openapi(getHealthRoute, (c) =>
  // Runtime check that the service still matches the contract.
  c.json(HealthResponseSchema.parse(getHealth()), 200),
);
