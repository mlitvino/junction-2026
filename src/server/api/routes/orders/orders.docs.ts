import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  CreateOrderFromPromptRequestSchema,
  CreateOrderFromPromptResponseSchema,
} from "@/shared/contracts/orders";

// OpenAPI definitions for prompt-driven procurement order routes. Handlers live in ./orders.ts.

export const postOrdersRoute = createRoute({
  method: "post",
  path: "/orders",
  tags: ["Orders"],
  summary: "Create a procurement order from a free-text user prompt",
  description:
    "Extracts product items from the user prompt, fetches candidate products by productType, " +
    "scores and sorts candidates by productName match, filters out products violating customer " +
    "preferences (dietary restrictions, allergens, nutrition), re-sorts by previous order history " +
    "(product and brand), compares total price against the customer budget, and creates an order.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateOrderFromPromptRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Created order with full procurement pipeline trace and budget comparison.",
      content: { "application/json": { schema: CreateOrderFromPromptResponseSchema } },
    },
    500: {
      description: "Order creation failed.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
