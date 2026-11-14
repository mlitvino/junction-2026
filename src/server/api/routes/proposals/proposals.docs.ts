import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  CreateProposalRequestSchema,
  ListProposalsQuerySchema,
  OrderSchema,
  PlaceOrderRequestSchema,
  ProcurementErrorSchema,
  ProposalListSchema,
  ProposalSchema,
} from "@/shared/contracts/procurement";

// OpenAPI definitions for proposals (and ordering one). Handlers live in ./proposals.ts.

const security = [{ sessionCookie: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const auth = {
  401: json(ErrorResponseSchema, "No valid session."),
  403: json(ProcurementErrorSchema, "Missing role, or not the proposal's creator."),
};
const notFound = { 404: json(ProcurementErrorSchema, "No such proposal in your organization.") };
const conflict = { 409: json(ProcurementErrorSchema, "Not possible in the proposal's current state.") };
const notAllowed = { 422: json(ProcurementErrorSchema, "Not allowed by the policy decision.") };
const IdParam = z.object({ id: z.string().meta({ description: "Proposal id." }) });

export const createProposalRoute = createRoute({
  method: "post",
  path: "/proposals",
  tags: ["Purchasing"],
  summary: "Create a proposal",
  description:
    "Prices the lines on the server, runs the policy check (the buyer's preferences) and freezes lines, prices, " +
    "total and decision. Status: `BLOCKED` when the policy denies it, otherwise `READY`. A proposal never changes: " +
    "to change it, create a new one and cancel the old one.",
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
  },
});
