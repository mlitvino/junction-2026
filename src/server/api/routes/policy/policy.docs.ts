import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import { PolicyDecisionSchema, PolicyEvaluateRequestSchema } from "@/shared/contracts/policy";

// OpenAPI definitions for the policy check. Handlers live in ./policy.ts.

const error = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponseSchema } },
});

export const evaluatePolicyRoute = createRoute({
  method: "post",
  path: "/policy/evaluate",
  tags: ["Policy"],
  summary: "Check a draft order against the organization's rules",
  description:
    "Applies the buyer's effective preferences (blocked vendors, excluded allergens, CO2, delivery reliability, " +
    "max order value, auto-approval, autonomy) and Valio's availability for the requested delivery `date` (sales " +
    "block, not deliverable, later than requested, too little known stock) to the given products and quantities. " +
    "Prices come from Valio on the server; amounts are EUR excluding VAT. Returns `ALLOW`, `REQUIRE_APPROVAL` or `DENY` with every reason that " +
    "applied. Nothing is stored. Missing product data (no CO2, allergens or reliability) never triggers a rule.",
  security: [{ sessionCookie: [] }],
  request: {
    body: { content: { "application/json": { schema: PolicyEvaluateRequestSchema } }, required: true },
  },
  responses: {
    200: { description: "The decision.", content: { "application/json": { schema: PolicyDecisionSchema } } },
    401: error("No valid session."),
    403: error("The user is neither buyer nor approver."),
    502: error("The Valio API failed or is unreachable."),
  },
});
