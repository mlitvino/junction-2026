import "server-only";

import {
  checkoutOrder,
  createOrderFromPrompt,
  decideOrderApproval,
  getOrderAuditTrail,
  getOrderDetail,
  getOrderReceipt,
  listOrders,
  modifyOrder,
  OrderServiceError,
} from "@/server/services/orders";
import {
  ApproveOrderResponseSchema,
  CheckoutOrderRequestSchema,
  CheckoutOrderResponseSchema,
  CreateOrderFromPromptResponseSchema,
  ModifyOrderResponseSchema,
  OrderAuditResponseSchema,
  OrderDetailResponseSchema,
  OrderListResponseSchema,
  OrderReceiptSchema,
} from "@/shared/contracts/orders";

import { resolveOptionalUser } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  approveOrderRoute,
  checkoutOrderRoute,
  getOrderAuditRoute,
  getOrderDetailRoute,
  getOrderReceiptRoute,
  listOrdersRoute,
  patchOrderRoute,
  postOrdersRoute,
} from "./orders.docs";

export const ordersRouter = createRouter()
  .openapi(postOrdersRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const result = await createOrderFromPrompt(c.req.valid("json"), actor);
    return c.json(CreateOrderFromPromptResponseSchema.parse(result), 200);
  })
  .openapi(listOrdersRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const result = await listOrders(actor);
    return c.json(OrderListResponseSchema.parse(result), 200);
  })
  .openapi(getOrderDetailRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const result = await getOrderDetail(c.req.valid("param").orderId, actor);
      return c.json(OrderDetailResponseSchema.parse(result), 200);
    } catch (err) {
      if (err instanceof OrderServiceError && err.status === 404) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  })
  .openapi(patchOrderRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const result = await modifyOrder(c.req.valid("param").orderId, c.req.valid("json"), actor);
      return c.json(ModifyOrderResponseSchema.parse(result), 200);
    } catch (err) {
      if (!(err instanceof OrderServiceError)) throw err;
      if (err.status === 400) return c.json({ error: err.message }, 400);
      if (err.status === 404) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 409);
    }
  })
  .openapi(approveOrderRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const result = await decideOrderApproval(
        c.req.valid("param").orderId,
        c.req.valid("json"),
        actor,
      );
      return c.json(ApproveOrderResponseSchema.parse(result), 200);
    } catch (err) {
      if (!(err instanceof OrderServiceError)) throw err;
      if (err.status === 403) return c.json({ error: err.message }, 403);
      if (err.status === 404) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 409);
    }
  })
  .openapi(checkoutOrderRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    let rawBody: unknown = {};
    try {
      const text = await c.req.text();
      if (text.trim()) rawBody = JSON.parse(text);
    } catch {
      rawBody = {};
    }
    const parsedBody = CheckoutOrderRequestSchema.safeParse(rawBody);
    const body = parsedBody.success ? parsedBody.data : {};

    try {
      const result = await checkoutOrder(c.req.valid("param").orderId, body, actor);
      return c.json(CheckoutOrderResponseSchema.parse(result), 200);
    } catch (err) {
      if (!(err instanceof OrderServiceError)) throw err;
      if (err.status === 404) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 409);
    }
  })
  .openapi(getOrderReceiptRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const receipt = await getOrderReceipt(c.req.valid("param").orderId, actor);
      return c.json(OrderReceiptSchema.parse(receipt), 200);
    } catch (err) {
      if (!(err instanceof OrderServiceError)) throw err;
      if (err.status === 404) return c.json({ error: err.message }, 404);
      return c.json({ error: err.message }, 409);
    }
  })
  .openapi(getOrderAuditRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const audit = await getOrderAuditTrail(c.req.valid("param").orderId, actor);
      return c.json(OrderAuditResponseSchema.parse(audit), 200);
    } catch (err) {
      if (err instanceof OrderServiceError && err.status === 404) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });
