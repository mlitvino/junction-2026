import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import { CreateOrderFromRecipeRequestSchema, CreateOrderFromRecipeResponseSchema } from "@/shared/contracts/recipes";
import {
  AuditListSchema,
  CreateProposalFromPromptRequestSchema,
  CreateProposalRequestSchema,
  ProposalFromPromptResponseSchema,
  ProposalVerificationSchema,
  ReviseProposalRequestSchema,
  ReviseProposalResponseSchema,
  ListProposalsQuerySchema,
  OrderSchema,
  PlaceOrderRequestSchema,
  PurchasingErrorSchema,
  ProposalListSchema,
  ProposalSchema,
} from "@/shared/contracts/purchasing";

// OpenAPI definitions for proposals (and ordering one). Handlers live in ./proposals.ts.

const security = [{ sessionCookie: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const auth = {
  401: json(ErrorResponseSchema, "No valid session."),
  403: json(PurchasingErrorSchema, "Missing role, or not the proposal's creator."),
};
const notFound = { 404: json(PurchasingErrorSchema, "No such proposal in your organization.") };
const conflict = {
  409: json(
    PurchasingErrorSchema,
    "Not possible now. `code`: `INVALID_STATE` (current status), `QUOTE_EXPIRED` (prices older than 24 h), " +
      "`PRICE_CHANGED` / `AVAILABILITY_CHANGED` (order time: Valio's price or availability differs from the proposal), " +
      "`IDEMPOTENCY_CONFLICT` (key used for another proposal). Except `INVALID_STATE`, create a new proposal.",
  ),
};
const notAllowed = { 422: json(PurchasingErrorSchema, "Not allowed by the policy decision.") };
const IdParam = z.object({ id: z.string().meta({ description: "Proposal id." }) });

export const createProposalRoute = createRoute({
  method: "post",
  path: "/proposals",
  tags: ["Purchasing"],
  summary: "Create a proposal",
  description:
    "Prices the lines on the server for the requested delivery `date`, checks availability, runs the policy check " +
    "(the buyer's preferences) and freezes lines, prices, availability, total and decision. The prices hold for " +
    "24 hours (`quoteExpiresAt`). Status: `BLOCKED` when the policy denies it, otherwise `READY`. A proposal never " +
    "changes: to change it, create a new one and cancel the old one.",
  security,
  request: { body: { content: { "application/json": { schema: CreateProposalRequestSchema } }, required: true } },
  responses: {
    201: json(ProposalSchema, "Created."),
    ...auth,
    502: json(ErrorResponseSchema, "The Valio API failed or is unreachable."),
  },
});

export const listProposalsRoute = createRoute({
  method: "get",
  path: "/proposals",
  tags: ["Purchasing"],
  summary: "List proposals",
  description: "The organization's proposals, newest first (max 200), each with its approval and order id.",
  security,
  request: { query: ListProposalsQuerySchema },
  responses: { 200: json(ProposalListSchema, "Proposals."), ...auth },
});

export const getProposalRoute = createRoute({
  method: "get",
  path: "/proposals/{id}",
  tags: ["Purchasing"],
  summary: "Get a proposal",
  security,
  request: { params: IdParam },
  responses: { 200: json(ProposalSchema, "The proposal."), ...auth, ...notFound },
});

export const cancelProposalRoute = createRoute({
  method: "post",
  path: "/proposals/{id}/cancel",
  tags: ["Purchasing"],
  summary: "Cancel a proposal",
  description: "Only its creator, while `READY`, `PENDING_APPROVAL` or `APPROVED`. A pending approval is cancelled too.",
  security,
  request: { params: IdParam },
  responses: { 200: json(ProposalSchema, "Cancelled."), ...auth, ...notFound, ...conflict },
});

export const requestApprovalRoute = createRoute({
  method: "post",
  path: "/proposals/{id}/approval",
  tags: ["Purchasing"],
  summary: "Send a proposal for approval",
  description:
    "Only its creator, for a `READY` proposal whose decision is `REQUIRE_APPROVAL`. Creates a pending approval " +
    "bound to the proposal hash; the proposal becomes `PENDING_APPROVAL`. Repeating it returns the same approval.",
  security,
  request: { params: IdParam },
  responses: { 200: json(ProposalSchema, "Sent for approval."), ...auth, ...notFound, ...conflict, ...notAllowed },
});

export const placeOrderRoute = createRoute({
  method: "post",
  path: "/proposals/{id}/order",
  tags: ["Purchasing"],
  summary: "Order a proposal (simulated)",
  description:
    "Creates the order for an allowed (`READY` + `ALLOW`) or `APPROVED` proposal; the proposal becomes `ORDERED`. " +
    "The quote must not be expired, and Valio's current price and availability (cached up to 5 minutes) must still " +
    "match the proposal, otherwise 409 and nothing is ordered. " +
    "Send a client-generated `idempotencyKey`: repeating it returns the same order (200), using it for another " +
    "proposal is a 409. The order is simulated: nothing is sent to Valio.",
  security,
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: PlaceOrderRequestSchema } }, required: true },
  },
  responses: {
    201: json(OrderSchema, "Ordered."),
    200: json(OrderSchema, "Same idempotency key: the existing order."),
    ...auth,
    ...notFound,
    ...conflict,
    ...notAllowed,
    502: json(ErrorResponseSchema, "The Valio API failed or is unreachable (price re-check)."),
  },
});

const badRequest = { 400: json(PurchasingErrorSchema, "The request can't be applied (e.g. unknown product, no change recognized).") };
const valioDown = { 502: json(ErrorResponseSchema, "The Valio API failed or is unreachable.") };

export const createProposalFromPromptRoute = createRoute({
  method: "post",
  path: "/proposals/from-prompt",
  tags: ["Purchasing"],
  summary: "Create a proposal from a request in words",
  description:
    "The purchasing agent's pipeline: extract items from the text, pick catalog products that fit the organization's " +
    "dietary and allergen rules (preferring past orders), then create a normal proposal (priced, availability-checked, " +
    "policy-decided). `selection` explains every choice and lists warnings to check, e.g. when the requested unit " +
    "differs from the sales unit. `proposal` is null when nothing matched.",
  security,
  request: { body: { content: { "application/json": { schema: CreateProposalFromPromptRequestSchema } }, required: true } },
  responses: { 201: json(ProposalFromPromptResponseSchema, "Created (or nothing matched)."), ...auth, ...valioDown },
});

export const createProposalFromRecipeRoute = createRoute({
  method: "post",
  path: "/proposals/from-recipe",
  tags: ["Purchasing"],
  summary: "Create a proposal for a recipe",
  description:
    "Scales a recipe, subtracts kitchen stock and creates a proposal for what is still needed (same pipeline and " +
    "rules as from-prompt). The organization's rules always apply; a request can't override them.",
  security,
  request: { body: { content: { "application/json": { schema: CreateOrderFromRecipeRequestSchema } }, required: true } },
  responses: {
    201: json(CreateOrderFromRecipeResponseSchema, "Created (or nothing to order)."),
    ...badRequest,
    ...auth,
    404: json(PurchasingErrorSchema, "No such recipe."),
    ...valioDown,
  },
});

export const reviseProposalRoute = createRoute({
  method: "post",
  path: "/proposals/{id}/revise",
  tags: ["Purchasing"],
  summary: "Change a proposal",
  description:
    "Swap products, change quantities, remove or add lines, move the date, structured or in words (`prompt`). " +
    "Proposals never change: this creates a new, re-priced and re-checked proposal and cancels the old one. Creator only.",
  security,
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: ReviseProposalRequestSchema } }, required: true },
  },
  responses: {
    201: json(ReviseProposalResponseSchema, "The new proposal."),
    ...badRequest,
    ...auth,
    ...notFound,
    ...conflict,
    ...valioDown,
  },
});

export const getProposalAuditRoute = createRoute({
  method: "get",
  path: "/proposals/{id}/audit",
  tags: ["Purchasing"],
  summary: "History of a proposal",
  description: "Everything that happened to the proposal and why: agent selection steps, policy decision, approval, order.",
  security,
  request: { params: IdParam },
  responses: { 200: json(AuditListSchema, "Events, oldest first."), ...auth, ...notFound },
});

export const verifyProposalRoute = createRoute({
  method: "get",
  path: "/proposals/{id}/verify",
  tags: ["Purchasing"],
  summary: "Verify a proposal",
  description:
    "Recomputes the SHA-256 content hash and checks each frozen price against the Valio price snapshots we recorded, " +
    "so a buyer, approver or agent can trust the numbers without a manual check.",
  security,
  request: { params: IdParam },
  responses: { 200: json(ProposalVerificationSchema, "Verification result."), ...auth, ...notFound },
});
