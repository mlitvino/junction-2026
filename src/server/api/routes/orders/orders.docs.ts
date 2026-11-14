import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import { OrderVerificationResponseSchema } from "@/shared/contracts/intelligence";
import {
  ApproveOrderRequestSchema,
  ApproveOrderResponseSchema,
  CheckoutOrderRequestSchema,
  CheckoutOrderResponseSchema,
  CreateOrderFromPromptRequestSchema,
  CreateOrderFromPromptResponseSchema,
  ModifyOrderRequestSchema,
  ModifyOrderResponseSchema,
  OrderAuditResponseSchema,
  OrderReceiptSchema,
} from "@/shared/contracts/orders";
import { OrderListSchema, OrderSchema, PurchasingErrorSchema } from "@/shared/contracts/purchasing";
import {
  CreateOrderFromRecipeRequestSchema,
  CreateOrderFromRecipeResponseSchema,
} from "@/shared/contracts/recipes";

// OpenAPI definitions for purchasing orders (feat/integrate-frontend) and procurement order lifecycle routes.

const security = [{ sessionCookie: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const auth = {
  401: json(ErrorResponseSchema, "No valid session."),
  403: json(ErrorResponseSchema, "Neither buyer nor approver."),
};

const orderIdParams = z.object({
  orderId: z.string().min(1).meta({ example: "ORD-8A7B6C5D" }),
});

export const postOrdersRoute = createRoute({
  method: "post",
  path: "/orders",
  tags: ["Orders"],
  summary: "Create a procurement order from a free-text user prompt",
  description:
    "Runs the end-to-end procurement pipeline: extracts items from prompt, searches products by " +
    "productType, scores by productName, filters by dietary/allergen/nutrition preferences, ranks " +
    "by previous order history, executes a fixed-price & availability inquiry, evaluates budget and " +
    "agent permission guardrails, logs a human-readable audit trail, and creates the order.",
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
      description: "Created order with pipeline trace, inquiry quote, guardrails, and audit trail.",
      content: { "application/json": { schema: CreateOrderFromPromptResponseSchema } },
    },
    500: {
      description: "Order creation failed.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const listOrdersRoute = createRoute({
  method: "get",
  path: "/orders",
  tags: ["Purchasing"],
  summary: "List orders",
  description: "The organization's simulated orders, newest first (max 200).",
  security,
  responses: { 200: json(OrderListSchema, "Orders."), ...auth },
});

export const getOrderRoute = createRoute({
  method: "get",
  path: "/orders/{id}",
  tags: ["Purchasing"],
  summary: "Get an order",
  security,
  request: { params: z.object({ id: z.string().meta({ description: "Order id." }) }) },
  responses: {
    200: json(OrderSchema, "The order."),
    ...auth,
    404: json(PurchasingErrorSchema, "No such order in your organization."),
  },
});

export const patchOrderRoute = createRoute({
  method: "patch",
  path: "/orders/{orderId}",
  tags: ["Orders"],
  summary:
    "Modify an order (swap product X for product Y, adjust quantities, or natural-language edit)",
  description:
    "Applies customer changes to an un-submitted order (e.g. swapping product X to product Y or " +
    "changing quantities), validates preferences, re-runs fixed-price & availability inquiry, " +
    "re-evaluates guardrails, and records the change in the audit trail.",
  request: {
    params: orderIdParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: ModifyOrderRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated order with refreshed inquiry quote and guardrail evaluation.",
      content: { "application/json": { schema: ModifyOrderResponseSchema } },
    },
    400: {
      description: "Invalid replacement, unknown product, or preference violation.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Order not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Order is already checked out or rejected.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const approveOrderRoute = createRoute({
  method: "post",
  path: "/orders/{orderId}/approval",
  tags: ["Orders"],
  summary: "Approve or reject an order awaiting human sign-off",
  description:
    "Human approval workflow for orders paused in 'pending_approval' by budget or guardrail checks. " +
    "When signed in, requires the 'approver' role in the order's organization.",
  request: {
    params: orderIdParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: ApproveOrderRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated order with recorded approval or rejection decision.",
      content: { "application/json": { schema: ApproveOrderResponseSchema } },
    },
    403: {
      description: "Signed-in user lacks the 'approver' role.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Order not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Order cannot transition approval state.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const checkoutOrderRoute = createRoute({
  method: "post",
  path: "/orders/{orderId}/checkout",
  tags: ["Orders"],
  summary: "Checkout an authorized order and issue an itemized fixed-price receipt",
  description:
    "Submits an authorized ('confirmed' or 'approved') order to Valio Aimo using confirmed fixed " +
    "inquiry prices, transitions status to 'checked_out', and returns the receipt.",
  request: {
    params: orderIdParams,
    body: {
      required: false,
      content: {
        "application/json": { schema: CheckoutOrderRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Checked-out order and official receipt.",
      content: { "application/json": { schema: CheckoutOrderResponseSchema } },
    },
    404: {
      description: "Order not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Order requires human approval or is not eligible for checkout.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const getOrderReceiptRoute = createRoute({
  method: "get",
  path: "/orders/{orderId}/receipt",
  tags: ["Orders"],
  summary: "Get the issued receipt for a checked-out order",
  request: {
    params: orderIdParams,
  },
  responses: {
    200: {
      description: "Issued Valio Aimo order receipt.",
      content: { "application/json": { schema: OrderReceiptSchema } },
    },
    404: {
      description: "Order not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    409: {
      description: "Order has not been checked out yet.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const getOrderAuditRoute = createRoute({
  method: "get",
  path: "/orders/{orderId}/audit",
  tags: ["Orders"],
  summary: "Get the human-readable and machine-verifiable audit trail for an order",
  request: {
    params: orderIdParams,
  },
  responses: {
    200: {
      description: "Audit trail events for the order.",
      content: { "application/json": { schema: OrderAuditResponseSchema } },
    },
    404: {
      description: "Order not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const postOrderFromRecipeRoute = createRoute({
  method: "post",
  path: "/orders/from-recipe",
  tags: ["Orders"],
  summary: "Create a procurement order from a dish recipe minus customer inventory stock",
  description:
    "Implements the recipe-to-order workflow: loads a recipe (by recipeId, dishQuery like " +
    "'salmon soup', or inline customRecipe), aggregates & scales ingredient quantities, subtracts " +
    "customer kitchen inventory stock (`actuallyNeeded = totalNeeded - inventoryStock`), and " +
    "orders the remaining ingredients through the full preference, inquiry, and guardrail pipeline.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateOrderFromRecipeRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description:
        "Created recipe order with ingredient inventory reconciliation and procurement trace.",
      content: { "application/json": { schema: CreateOrderFromRecipeResponseSchema } },
    },
    400: {
      description: "Missing recipe selector.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "Recipe not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const getOrderVerificationRoute = createRoute({
  method: "get",
  path: "/orders/{orderId}/verify",
  tags: ["Orders"],
  summary: "Cryptographically verify fixed-price, stock, origin, allergen, and audit claims",
  description:
    "Open Trust & Verification Layer: returns canonical-JSON SHA-256 proofs over price quotes, " +
    "stock availability, origin & sustainability labels, allergen compliance, guardrails, and " +
    "the chronological audit-trail hash chain.",
  request: {
    params: orderIdParams,
  },
  responses: {
    200: {
      description: "SHA-256 verification proofs for all order claims.",
      content: { "application/json": { schema: OrderVerificationResponseSchema } },
    },
    404: {
      description: "Order not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
