import "server-only";

import { evaluateDraft } from "@/server/services/policy";
import { ValioApiError } from "@/server/valio/client";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { evaluatePolicyRoute } from "./policy.docs";

export const policyRouter = createRouter();

// Separate statement: `.use()` returns a plain Hono type (see routes/me/me.ts).
policyRouter.use("/policy/*", requireRole("buyer", "approver"));

policyRouter.openapi(evaluatePolicyRoute, async (c) => {
  try {
    return c.json(await evaluateDraft(c.var.user.organization.id, c.req.valid("json")), 200);
  } catch (err) {
    if (!(err instanceof ValioApiError)) throw err;
    console.error("Valio request failed", err.status, err.message);
    return c.json({ error: "Valio is unavailable" }, 502);
  }
});
