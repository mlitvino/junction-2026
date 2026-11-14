import "server-only";

import { verifyOrderTrustClaims } from "@/server/services/intelligence";
import {
  checkoutOrder,
  createOrderFromPrompt,
  decideOrderApproval,
  getOrderAuditTrail,
  getOrderReceipt,
  modifyOrder,
  OrderServiceError,
} from "@/server/services/orders";
import { PurchasingError, getOrder, listOrders } from "@/server/services/purchasing";
import { createOrderFromRecipe, RecipeServiceError } from "@/server/services/recipes";
import { OrderVerificationResponseSchema } from "@/shared/contracts/intelligence";
import {
  ApproveOrderResponseSchema,
  CheckoutOrderRequestSchema,
  CheckoutOrderResponseSchema,
  CreateOrderFromPromptResponseSchema,
  ModifyOrderResponseSchema,
  OrderAuditResponseSchema,
  OrderReceiptSchema,
} from "@/shared/contracts/orders";
import { CreateOrderFromRecipeResponseSchema } from "@/shared/contracts/recipes";

import { requireRole, resolveOptionalUser } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  approveOrderRoute,
  checkoutOrderRoute,
  getOrderAuditRoute,
  getOrderReceiptRoute,
  getOrderRoute,
  getOrderVerificationRoute,
  listOrdersRoute,
  patchOrderRoute,
  postOrderFromRecipeRoute,
  postOrdersRoute,
} from "./orders.docs";

export const ordersRouter = createRouter();

// Buyers and approvers for purchasing order reads (`GET /orders`, `GET /orders/:id`).
// Method-scoped `.on("GET", ...)` keeps procurement POST/PATCH routes unaffected.
ordersRouter.on("GET", "/orders", requireRole("buyer", "approver"));
ordersRouter.on("GET", "/orders/:id", requireRole("buyer", "approver"));

const purchasingActor = (user: { id: string; organization: { id: string } }) => ({
  organizationId: user.organization.id,
  userId: user.id,
});

ordersRouter
  .openapi(listOrdersRoute, async (c) =>
    c.json({ items: await listOrders(purchasingActor(c.var.user)) }, 200),
  )
  .openapi(getOrderRoute, async (c) => {
    try {
      return c.json(await getOrder(purchasingActor(c.var.user), c.req.valid("param").id), 200);
    } catch (err) {
      if (!(err instanceof PurchasingError)) throw err;
      return c.json({ error: err.message, code: err.code }, 404);
    }
  })
  .openapi(postOrdersRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const result = await createOrderFromPrompt(c.req.valid("json"), actor);
    return c.json(CreateOrderFromPromptResponseSchema.parse(result), 200);
  })
  .openapi(postOrderFromRecipeRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const result = await createOrderFromRecipe(c.req.valid("json"), actor);
      return c.json(CreateOrderFromRecipeResponseSchema.parse(result), 200);
    } catch (err) {
      if (err instanceof RecipeServiceError) {
        if (err.status === 400) return c.json({ error: err.message }, 400);
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
  })
  .openapi(getOrderVerificationRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const verification = await verifyOrderTrustClaims(c.req.valid("param").orderId, actor);
      return c.json(OrderVerificationResponseSchema.parse(verification), 200);
    } catch (err) {
      if (err instanceof OrderServiceError && err.status === 404) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });
