import "server-only";

import { PurchasingError, getOrder, listOrders } from "@/server/services/purchasing";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { getOrderRoute, listOrdersRoute } from "./orders.docs";

export const ordersRouter = createRouter();

// Buyers and approvers. Separate statements: `.use()` returns a plain Hono type (see routes/me/me.ts).
ordersRouter.use("/orders", requireRole("buyer", "approver"));
ordersRouter.use("/orders/*", requireRole("buyer", "approver"));

const actor = (user: { id: string; organization: { id: string } }) => ({
  organizationId: user.organization.id,
  userId: user.id,
});

ordersRouter.openapi(listOrdersRoute, async (c) => c.json({ items: await listOrders(actor(c.var.user)) }, 200));

ordersRouter.openapi(getOrderRoute, async (c) => {
  try {
    return c.json(await getOrder(actor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    if (!(err instanceof PurchasingError)) throw err;
    return c.json({ error: err.message, code: err.code }, 404);
  }
});
