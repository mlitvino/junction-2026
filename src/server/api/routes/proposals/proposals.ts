import "server-only";

import {
  ProcurementError,
  cancelProposal,
  createProposal,
  getProposal,
  listProposals,
  placeOrder,
  requestApproval,
} from "@/server/services/procurement";
import { ValioApiError } from "@/server/valio/client";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  cancelProposalRoute,
  createProposalRoute,
  getProposalRoute,
  listProposalsRoute,
  placeOrderRoute,
  requestApprovalRoute,
} from "./proposals.docs";

export const proposalsRouter = createRouter();

// Reading: buyers and approvers. Changing: buyers (creator checks are in the service).
// Separate statements: `.use()` returns a plain Hono type (see routes/me/me.ts).
proposalsRouter.use("/proposals", async (c, next) =>
  (c.req.method === "POST" ? requireRole("buyer") : requireRole("buyer", "approver"))(c, next),
);
proposalsRouter.use("/proposals/*", async (c, next) =>
  (c.req.method === "POST" ? requireRole("buyer") : requireRole("buyer", "approver"))(c, next),
);

const actor = (user: { id: string; organization: { id: string } }) => ({
  organizationId: user.organization.id,
  userId: user.id,
});

/** Expected failures as JSON; anything else goes to the app's 500 handler. */
function failure(err: unknown) {
  if (err instanceof ProcurementError) return { body: { error: err.message, code: err.code }, status: err.status };
  throw err;
}

proposalsRouter.openapi(createProposalRoute, async (c) => {
  try {
    return c.json(await createProposal(actor(c.var.user), c.req.valid("json")), 201);
  } catch (err) {
    if (!(err instanceof ValioApiError)) throw err;
    console.error("Valio request failed", err.status, err.message);
    return c.json({ error: "Valio is unavailable" }, 502);
  }
});

proposalsRouter.openapi(listProposalsRoute, async (c) =>
  c.json({ items: await listProposals(actor(c.var.user), c.req.valid("query")) }, 200),
);

proposalsRouter.openapi(getProposalRoute, async (c) => {
  try {
    return c.json(await getProposal(actor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    const f = failure(err);
    return c.json(f.body, 404);
  }
});

proposalsRouter.openapi(cancelProposalRoute, async (c) => {
  try {
    return c.json(await cancelProposal(actor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    const f = failure(err);
    if (f.status === 403) return c.json(f.body, 403);
    if (f.status === 404) return c.json(f.body, 404);
    return c.json(f.body, 409);
  }
});

proposalsRouter.openapi(requestApprovalRoute, async (c) => {
  try {
    return c.json(await requestApproval(actor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    const f = failure(err);
    if (f.status === 403) return c.json(f.body, 403);
    if (f.status === 404) return c.json(f.body, 404);
    if (f.status === 422) return c.json(f.body, 422);
    return c.json(f.body, 409);
  }
});

proposalsRouter.openapi(placeOrderRoute, async (c) => {
  try {
    const { order, replayed } = await placeOrder(
      actor(c.var.user),
      c.req.valid("param").id,
      c.req.valid("json").idempotencyKey,
    );
    return replayed ? c.json(order, 200) : c.json(order, 201);
  } catch (err) {
    const f = failure(err);
    if (f.status === 403) return c.json(f.body, 403);
    if (f.status === 404) return c.json(f.body, 404);
    if (f.status === 422) return c.json(f.body, 422);
    return c.json(f.body, 409);
  }
});
