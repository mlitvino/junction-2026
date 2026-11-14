import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  checkRecurringOrderAnomalies,
  evaluateProductSubstitutions,
  getProactiveRecommendations,
  getProactiveStockoutAlerts,
} from "@/server/services/intelligence";
import {
  ProactiveRecommendationsResponseSchema,
  ProductSubstitutionResponseSchema,
  RecurringOrderCheckResponseSchema,
  StockoutAlertsResponseSchema,
} from "@/shared/contracts/intelligence";

import { toolActor } from "./actor";

export const evaluateSubstitutionsTool = createTool({
  id: "evaluate-product-substitutions",
  description:
    "Recommend allergen-safe Best/Better/Good substitute products with price, delivery, and category CO2 trade-offs, plus a partial-availability split plan.",
  inputSchema: z.object({
    productId: z.string().describe("Valio product ID to evaluate substitutes for."),
    requestedQuantity: z
      .number()
      .positive()
      .default(100)
      .describe("Desired quantity to test stock coverage."),
    deliveryDate: z.string().optional().describe("Optional YYYY-MM-DD delivery date."),
  }),
  outputSchema: ProductSubstitutionResponseSchema,
  execute: async ({ productId, requestedQuantity, deliveryDate }, context) =>
    evaluateProductSubstitutions({ productId, requestedQuantity, deliveryDate }, toolActor(context)),
});

export const getStockoutAlertsTool = createTool({
  id: "get-proactive-stockout-alerts",
  description:
    "Detect supplier out-of-stock SKUs and low kitchen par-level items, list impacted recipes, and propose allergen-safe replacements.",
  inputSchema: z.object({
    deliveryDate: z.string().optional().describe("Optional YYYY-MM-DD delivery date."),
  }),
  outputSchema: StockoutAlertsResponseSchema,
  execute: async ({ deliveryDate }, context) => getProactiveStockoutAlerts(deliveryDate, toolActor(context)),
});

export const checkRecurringAnomaliesTool = createTool({
  id: "check-recurring-order-anomalies",
  description:
    "Check a proposal against the organization's order history to catch unusual quantity or cost spikes before ordering.",
  inputSchema: z.object({
    proposalId: z.string().describe("Proposal to compare with past orders."),
  }),
  outputSchema: RecurringOrderCheckResponseSchema,
  execute: async ({ proposalId }, context) => checkRecurringOrderAnomalies({ proposalId }, toolActor(context)),
});

export const getProactiveRecommendationsTool = createTool({
  id: "get-proactive-recommendations",
  description:
    "Suggest seasonal Nordic products, newly available items, low-carbon switches, and kitchen par-level replenishments tailored to customer preferences.",
  inputSchema: z.object({}),
  outputSchema: ProactiveRecommendationsResponseSchema,
  execute: async (_input, context) => getProactiveRecommendations(toolActor(context)),
});

