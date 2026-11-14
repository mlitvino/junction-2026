import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  checkRecurringOrderAnomalies,
  evaluateProductSubstitutions,
  getProactiveRecommendations,
  getProactiveStockoutAlerts,
  verifyOrderTrustClaims,
} from "@/server/services/intelligence";
import {
  OrderVerificationResponseSchema,
  ProactiveRecommendationsResponseSchema,
  ProductSubstitutionResponseSchema,
  RecurringOrderCheckResponseSchema,
  StockoutAlertsResponseSchema,
} from "@/shared/contracts/intelligence";
import type { SessionUser } from "@/shared/contracts/me";

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
  execute: async ({ productId, requestedQuantity, deliveryDate }, context) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return evaluateProductSubstitutions({ productId, requestedQuantity, deliveryDate }, actor);
  },
});

export const getStockoutAlertsTool = createTool({
  id: "get-proactive-stockout-alerts",
  description:
    "Detect supplier out-of-stock SKUs and low kitchen par-level items, list impacted recipes, and propose allergen-safe replacements.",
  inputSchema: z.object({
    deliveryDate: z.string().optional().describe("Optional YYYY-MM-DD delivery date."),
  }),
  outputSchema: StockoutAlertsResponseSchema,
  execute: async ({ deliveryDate }, context) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return getProactiveStockoutAlerts(deliveryDate, actor);
  },
});

export const checkRecurringAnomaliesTool = createTool({
  id: "check-recurring-order-anomalies",
  description:
    "Check an order against historical purchasing baselines to catch unusual quantity spikes, drops, or cost anomalies before repeating.",
  inputSchema: z.object({
    orderId: z.string().describe("Order ID to evaluate against historical baseline."),
  }),
  outputSchema: RecurringOrderCheckResponseSchema,
  execute: async ({ orderId }, context) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return checkRecurringOrderAnomalies({ orderId }, actor);
  },
});

export const getProactiveRecommendationsTool = createTool({
  id: "get-proactive-recommendations",
  description:
    "Suggest seasonal Nordic products, newly available items, low-carbon switches, and kitchen par-level replenishments tailored to customer preferences.",
  inputSchema: z.object({}),
  outputSchema: ProactiveRecommendationsResponseSchema,
  execute: async (_input, context) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return getProactiveRecommendations(actor);
  },
});

export const verifyOrderTrustTool = createTool({
  id: "verify-order-trust-claims",
  description:
    "Generate canonical-JSON SHA-256 verification proofs for fixed prices, stock availability, origin, allergen compliance, guardrails, and audit trail integrity.",
  inputSchema: z.object({
    orderId: z.string().describe("Order ID to cryptographically verify."),
  }),
  outputSchema: OrderVerificationResponseSchema,
  execute: async ({ orderId }, context) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return verifyOrderTrustClaims(orderId, actor);
  },
});
