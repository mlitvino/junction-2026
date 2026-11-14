import "server-only";

import { actorFor, getOrder, getOrderReceipt, listOrders, PurchasingError } from "@/server/services/purchasing";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { getOrderReceiptRoute, getOrderRoute, listOrdersRoute } from "./orders.docs";

export const ordersRouter = createRouter();

// Buyers and approvers read orders. Separate statements: `.use()` returns a plain Hono type.
ordersRouter.use("/orders", requireRole("buyer", "approver"));
ordersRouter.use("/orders/*", requireRole("buyer", "approver"));

ordersRouter.openapi(listOrdersRoute, async (c) => c.json({ items: await listOrders(actorFor(c.var.user)) }, 200));

ordersRouter.openapi(getOrderRoute, async (c) => {
  try {
    return c.json(await getOrder(actorFor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    if (!(err instanceof PurchasingError)) throw err;
    return c.json({ error: err.message, code: err.code }, 404);
  }
});

ordersRouter.openapi(getOrderReceiptRoute, async (c) => {
  try {
    return c.json(await getOrderReceipt(actorFor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    if (!(err instanceof PurchasingError)) throw err;
    return c.json({ error: err.message, code: err.code }, 404);
  }
});
