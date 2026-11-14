import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { AgentRunRequestSchema, AgentRunResponseSchema } from "@/shared/contracts/agent";
import { ErrorResponseSchema } from "@/shared/contracts/errors";

export const postAgentRunRoute = createRoute({
  method: "post",
  path: "/agent/run",
  tags: ["Agent"],
  summary: "Run an autonomous turn of the Valio Aimo Purchasing Agent",
  description:
    "Open conversational and tool-driven interface to the Mastra purchasingAgent. Supports " +
    "searching products, running fixed-price & availability inquiries, creating orders within " +
    "guardrails, swapping products on existing orders, and checking out authorized orders.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: AgentRunRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Agent reply, tool invocation trace, and active order state.",
      content: { "application/json": { schema: AgentRunResponseSchema } },
    },
    400: {
      description: "Invalid agent action or order modification.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Referenced order not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Order action blocked by approval or lifecycle state.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
