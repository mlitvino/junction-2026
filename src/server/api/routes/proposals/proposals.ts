import "server-only";

import { listAudit } from "@/server/services/audit";
import {
  actorFor,
  cancelProposal,
  createProposal,
  getProposal,
  listProposals,
  placeOrder,
  PurchasingError,
  requestApproval,
  verifyProposal,
} from "@/server/services/purchasing";
import { createProposalFromRecipe, RecipeServiceError } from "@/server/services/recipes";
import { createProposalFromPrompt, reviseProposalFromRequest } from "@/server/services/selection";
import { ValioApiError } from "@/server/valio/client";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  cancelProposalRoute,
  createProposalFromPromptRoute,
  createProposalFromRecipeRoute,
  createProposalRoute,
  getProposalAuditRoute,
  getProposalRoute,
  listProposalsRoute,
  placeOrderRoute,
  requestApprovalRoute,
  reviseProposalRoute,
  verifyProposalRoute,
} from "./proposals.docs";

export const proposalsRouter = createRouter();

// Reading: buyers and approvers. Creating and changing: buyers (creator checks are in the service).
// Separate statements: `.use()` returns a plain Hono type (see routes/me/me.ts).
const byMethod = (method: string) => (method === "GET" ? requireRole("buyer", "approver") : requireRole("buyer"));
proposalsRouter.use("/proposals", async (c, next) => byMethod(c.req.method)(c, next));
proposalsRouter.use("/proposals/*", async (c, next) => byMethod(c.req.method)(c, next));

/** Expected failures as JSON; anything else goes to the app's 500 handler. */
function failure(err: unknown) {
  if (err instanceof PurchasingError) return { body: { error: err.message, code: err.code }, status: err.status };
  throw err;
}

function valioDown(err: unknown): boolean {
  if (!(err instanceof ValioApiError)) return false;
  console.error("Valio request failed", err.status, err.message);
  return true;
}

proposalsRouter.openapi(createProposalRoute, async (c) => {
  try {
    return c.json(await createProposal(actorFor(c.var.user), c.req.valid("json")), 201);
  } catch (err) {
    if (!valioDown(err)) throw err;
    return c.json({ error: "Valio is unavailable. Try again in a moment.", code: "VALIO_UNAVAILABLE" }, 502);
  }
});

proposalsRouter.openapi(createProposalFromPromptRoute, async (c) => {
  try {
    return c.json(await createProposalFromPrompt(actorFor(c.var.user), c.req.valid("json")), 201);
  } catch (err) {
    if (!valioDown(err)) throw err;
    return c.json({ error: "Valio is unavailable. Try again in a moment.", code: "VALIO_UNAVAILABLE" }, 502);
  }
});

proposalsRouter.openapi(createProposalFromRecipeRoute, async (c) => {
  try {
    return c.json(await createProposalFromRecipe(c.req.valid("json"), c.var.user), 201);
  } catch (err) {
    if (valioDown(err)) return c.json({ error: "Valio is unavailable. Try again in a moment.", code: "VALIO_UNAVAILABLE" }, 502);
    if (err instanceof RecipeServiceError) {
      const body = { error: err.message, code: err.status === 404 ? "NOT_FOUND" : "INVALID_RECIPE" };
      return err.status === 404 ? c.json(body, 404) : c.json(body, 400);
    }
    throw err;
  }
});

proposalsRouter.openapi(listProposalsRoute, async (c) =>
  c.json({ items: await listProposals(actorFor(c.var.user), c.req.valid("query")) }, 200),
);

proposalsRouter.openapi(getProposalRoute, async (c) => {
  try {
    return c.json(await getProposal(actorFor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    return c.json(failure(err).body, 404);
  }
});

proposalsRouter.openapi(reviseProposalRoute, async (c) => {
  try {
    return c.json(await reviseProposalFromRequest(actorFor(c.var.user), c.req.valid("param").id, c.req.valid("json")), 201);
  } catch (err) {
    if (valioDown(err)) return c.json({ error: "Valio is unavailable. Try again in a moment.", code: "VALIO_UNAVAILABLE" }, 502);
    const f = failure(err);
    if (f.status === 400) return c.json(f.body, 400);
    if (f.status === 403) return c.json(f.body, 403);
    if (f.status === 404) return c.json(f.body, 404);
    return c.json(f.body, 409);
  }
});

proposalsRouter.openapi(cancelProposalRoute, async (c) => {
  try {
    return c.json(await cancelProposal(actorFor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    const f = failure(err);
    if (f.status === 403) return c.json(f.body, 403);
    if (f.status === 404) return c.json(f.body, 404);
    return c.json(f.body, 409);
  }
});

proposalsRouter.openapi(requestApprovalRoute, async (c) => {
  try {
    return c.json(await requestApproval(actorFor(c.var.user), c.req.valid("param").id), 200);
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
      actorFor(c.var.user),
      c.req.valid("param").id,
      c.req.valid("json").idempotencyKey,
    );
    return replayed ? c.json(order, 200) : c.json(order, 201);
  } catch (err) {
    if (valioDown(err)) return c.json({ error: "Valio is unavailable. Try again in a moment.", code: "VALIO_UNAVAILABLE" }, 502);
    const f = failure(err);
    if (f.status === 403) return c.json(f.body, 403);
    if (f.status === 404) return c.json(f.body, 404);
    if (f.status === 422) return c.json(f.body, 422);
    return c.json(f.body, 409);
  }
});

proposalsRouter.openapi(getProposalAuditRoute, async (c) => {
  const actor = actorFor(c.var.user);
  const { id } = c.req.valid("param");
  try {
    await getProposal(actor, id); // 404 for other organizations' ids
  } catch (err) {
    return c.json(failure(err).body, 404);
  }
  const items = await listAudit(actor.organizationId, { resourceType: "proposal", resourceId: id, limit: 500 });
  return c.json({ items: items.reverse() }, 200);
});

proposalsRouter.openapi(verifyProposalRoute, async (c) => {
  try {
    return c.json(await verifyProposal(actorFor(c.var.user), c.req.valid("param").id), 200);
  } catch (err) {
    return c.json(failure(err).body, 404);
  }
});
