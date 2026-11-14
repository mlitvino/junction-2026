import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { AgentErrorResponseSchema } from "@/shared/contracts/errors";
import { ExtractRequestSchema, ExtractResponseSchema } from "@/shared/contracts/extract";

// OpenAPI definitions for prompt extraction routes. Handlers live in ./extract.ts.

export const postExtractRoute = createRoute({
  method: "post",
  path: "/extract",
  tags: ["Agents"],
  summary: "Extract product items from a free-text prompt",
  description:
    "Parses a free-form natural-language purchasing request into structured product items " +
    "(productName, productType, productQuantity).",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: ExtractRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Extracted product items.",
      content: { "application/json": { schema: ExtractResponseSchema } },
    },
    502: {
      description: "The language model call failed or returned unusable output (`MODEL_FAILED`); retry.",
      content: { "application/json": { schema: AgentErrorResponseSchema } },
    },
    503: {
      description: "The agent isn't configured: no Gemini key on the server and not in TEST_MODE (`AGENT_NOT_CONFIGURED`).",
      content: { "application/json": { schema: AgentErrorResponseSchema } },
    },
  },
});
