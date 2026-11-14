import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { AgentRunRequestSchema, AgentRunResponseSchema } from "@/shared/contracts/agent";
import { AgentErrorResponseSchema, ErrorResponseSchema } from "@/shared/contracts/errors";

export const postAgentRunRoute = createRoute({
  method: "post",
  path: "/agent/run",
  tags: ["Agent"],
  summary: "Run an autonomous turn of the Valio Aimo Purchasing Agent",
  description:
    "One turn of the purchasing agent, acting for the signed-in buyer: search products, ask prices and " +
    "availability, create and revise proposals, and order a proposal only when the organization's rules allow " +
    "it or an approver approved it. The agent never approves. Buyers only.",
  security: [{ sessionCookie: [] }],
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
      description: "Agent reply, tool trace and the proposal it worked on.",
      content: { "application/json": { schema: AgentRunResponseSchema } },
    },
    400: {
      description: "The requested change could not be applied.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Not a buyer, or not the proposal's creator.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Referenced proposal not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Not possible in the proposal's current state (e.g. expired quote, changed price).",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    502: {
      description: "The language model call failed (`MODEL_FAILED`); retry.",
      content: { "application/json": { schema: AgentErrorResponseSchema } },
    },
    503: {
      description: "The agent isn't configured: no Gemini key on the server and not in TEST_MODE (`AGENT_NOT_CONFIGURED`).",
      content: { "application/json": { schema: AgentErrorResponseSchema } },
    },
  },
});
