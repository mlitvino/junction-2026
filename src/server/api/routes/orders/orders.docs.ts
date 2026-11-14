import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  OrderListSchema,
  OrderReceiptSchema,
  OrderSchema,
  PurchasingErrorSchema,
} from "@/shared/contracts/purchasing";

// OpenAPI definitions for orders. Orders are created only by ordering a proposal
// (POST /proposals/{id}/order). Handlers live in ./orders.ts.

const security = [{ sessionCookie: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const auth = {
  401: json(ErrorResponseSchema, "No valid session."),
  403: json(ErrorResponseSchema, "Neither buyer nor approver."),
};
const IdParam = z.object({ id: z.string().meta({ description: "Order id." }) });

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
  request: { params: IdParam },
  responses: {
    200: json(OrderSchema, "The order."),
    ...auth,
    404: json(PurchasingErrorSchema, "No such order in your organization."),
  },
});

export const getOrderReceiptRoute = createRoute({
  method: "get",
  path: "/orders/{id}/receipt",
  tags: ["Purchasing"],
  summary: "Order receipt",
  description: "Itemized receipt: lines and frozen prices, who ordered, who approved, the proposal hash.",
  security,
  request: { params: IdParam },
  responses: {
    200: json(OrderReceiptSchema, "The receipt."),
    ...auth,
    404: json(PurchasingErrorSchema, "No such order in your organization."),
  },
});
