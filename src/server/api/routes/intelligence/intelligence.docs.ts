import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  ProactiveRecommendationsResponseSchema,
  RecurringOrderCheckRequestSchema,
  RecurringOrderCheckResponseSchema,
  StockoutAlertsResponseSchema,
} from "@/shared/contracts/intelligence";

export const getStockoutAlertsRoute = createRoute({
  method: "get",
  path: "/intelligence/stockout-alerts",
  tags: ["Intelligence"],
  summary: "Proactive supplier-stock-out & kitchen par-level shortage alerts",
  description:
    "Detects supplier out-of-stock SKUs and low kitchen inventory items, identifies impacted " +
    "customer/Valio recipes, and proposes allergen-safe, recipe-compatible replacements.",
  request: {
    query: z.object({
      deliveryDate: z.iso.date().optional().meta({
        description: "Optional target delivery date (YYYY-MM-DD).",
        example: "2026-11-16",
      }),
    }),
  },
  responses: {
    200: {
      description: "Active supplier stock-out and kitchen shortage alerts with replacements.",
      content: { "application/json": { schema: StockoutAlertsResponseSchema } },
    },
  },
});

export const postRecurringOrderCheckRoute = createRoute({
  method: "post",
  path: "/intelligence/recurring-check",
  tags: ["Intelligence"],
  summary: "Detect unusual quantity or cost anomalies before repeating an order",
  description:
    "Compares an existing order or proposed recurring line items against historical order " +
    "baselines and budget limits to catch accidental quantity spikes, drops, or price surges.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: RecurringOrderCheckRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Anomaly analysis result.",
      content: { "application/json": { schema: RecurringOrderCheckResponseSchema } },
    },
    400: {
      description: "Missing orderId and items.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Referenced order or product not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const getProactiveRecommendationsRoute = createRoute({
  method: "get",
  path: "/intelligence/recommendations",
  tags: ["Intelligence"],
  summary: "Proactive supplier-side seasonal, new, and low-carbon product recommendations",
  description:
    "Suggests seasonal Nordic products, newly available items, low-carbon switches, and " +
    "kitchen par-level replenishments tailored to the buyer's preferences and allergens.",
  responses: {
    200: {
      description: "Tailored supplier product recommendations.",
      content: { "application/json": { schema: ProactiveRecommendationsResponseSchema } },
    },
  },
});
