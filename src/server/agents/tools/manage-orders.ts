import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  checkoutOrder,
  createOrderFromPrompt,
  getOrderDetail,
  modifyOrder,
} from "@/server/services/orders";
import {
  CheckoutOrderResponseSchema,
  CreateOrderFromPromptResponseSchema,
  ModifyOrderResponseSchema,
  OrderDetailResponseSchema,
  OrderProductReplacementSchema,
  OrderQuantityUpdateSchema,
} from "@/shared/contracts/orders";

export const createProcurementOrderTool = createTool({
  id: "create-procurement-order",
  description:
    "Run the full procurement pipeline from a buyer request: extract items, search & rank products by preferences and order history, execute a fixed-price & availability inquiry, check agent guardrails/budget, and create an order (confirmed or pending_approval).",
  inputSchema: z.object({
    prompt: z.string().describe("Buyer's natural-language purchasing prompt."),
    deliveryDate: z.string().optional().describe("Optional YYYY-MM-DD delivery date."),
    budgetEur: z.number().positive().optional().describe("Optional budget override in EUR."),
  }),
  outputSchema: CreateOrderFromPromptResponseSchema,
  execute: async ({ prompt, deliveryDate, budgetEur }) =>
    createOrderFromPrompt({
      prompt,
      deliveryDate,
      budgetEur,
    }),
});

export const modifyOrderTool = createTool({
  id: "modify-order",
  description:
    "Modify an existing order before checkout: swap product X for product Y, adjust quantities, remove products, or apply a natural-language change request. Re-runs fixed-price inquiry and guardrail checks.",
  inputSchema: z.object({
    orderId: z.string().describe("ID of the order to modify, e.g. 'ORD-8A7B6C5D'."),
    prompt: z
      .string()
      .optional()
      .describe("Natural-language modification instruction, e.g. 'Change 460101 to 460301'."),
    replacements: z.array(OrderProductReplacementSchema).optional(),
    quantityUpdates: z.array(OrderQuantityUpdateSchema).optional(),
    removeProductIds: z.array(z.string()).optional(),
  }),
  outputSchema: ModifyOrderResponseSchema,
  execute: async ({ orderId, prompt, replacements, quantityUpdates, removeProductIds }) =>
    modifyOrder(orderId, {
      prompt,
      replacements,
      quantityUpdates,
      removeProductIds,
    }),
});

export const checkoutOrderTool = createTool({
  id: "checkout-order",
  description:
    "Submit an authorized ('confirmed' or 'approved') order to Valio Aimo and issue an itemized fixed-price receipt. Will fail if the order is still 'pending_approval'.",
  inputSchema: z.object({
    orderId: z.string().describe("ID of the authorized order to check out."),
    customerReference: z.string().optional().describe("Optional PO or kitchen reference."),
    deliveryNotes: z.string().optional().describe("Optional delivery instructions."),
  }),
  outputSchema: CheckoutOrderResponseSchema,
  execute: async ({ orderId, customerReference, deliveryNotes }) =>
    checkoutOrder(orderId, {
      customerReference,
      deliveryNotes,
    }),
});

export const getOrderDetailsTool = createTool({
  id: "get-order-details",
  description:
    "Retrieve full details of an existing order including lines, inquiry quote, guardrail status, human approval status, suggested product alternatives, receipt, and audit trail.",
  inputSchema: z.object({
    orderId: z.string().describe("Order ID to inspect."),
  }),
  outputSchema: OrderDetailResponseSchema,
  execute: async ({ orderId }) => getOrderDetail(orderId),
});
