import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  ApprovalListSchema,
  DecideApprovalRequestSchema,
  ListApprovalsQuerySchema,
  PendingApprovalCountSchema,
  PurchasingErrorSchema,
  ProposalSchema,
} from "@/shared/contracts/purchasing";

// OpenAPI definitions for approvals. Handlers live in ./approvals.ts.

const security = [{ sessionCookie: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

export const listApprovalsRoute = createRoute({
  method: "get",
  path: "/approvals",
  tags: ["Purchasing"],
  summary: "List approvals",
  description: "The organization's approvals, newest first (max 200), each with its proposal. Approvers only.",
  security,
  request: { query: ListApprovalsQuerySchema },
  responses: {
    200: json(ApprovalListSchema, "Approvals."),
    401: json(ErrorResponseSchema, "No valid session."),
    403: json(ErrorResponseSchema, "Not an approver."),
  },
});

export const pendingApprovalCountRoute = createRoute({
  method: "get",
  path: "/approvals/pending-count",
  tags: ["Purchasing"],
  summary: "Count pending approvals",
  description:
    "For a badge: how many approvals wait for a decision and when the first of them expires. Expired approvals " +
    "(not decided before the proposal's quote expiry) are marked `EXPIRED` first and not counted. Approvers only.",
  security,
  responses: {
    200: json(PendingApprovalCountSchema, "Pending approvals."),
    401: json(ErrorResponseSchema, "No valid session."),
    403: json(ErrorResponseSchema, "Not an approver."),
  },
});

export const decideApprovalRoute = createRoute({
  method: "post",
  path: "/approvals/{id}/decision",
  tags: ["Purchasing"],
  summary: "Approve or reject",
  description:
    "Approvers only (a user holding both roles may decide their own proposal). Send the `hash` of the proposal " +
    "you reviewed; a mismatch is a 409. Rejecting needs a comment. Returns the updated proposal.",
  security,
  request: {
    params: z.object({ id: z.string().meta({ description: "Approval id." }) }),
    body: { content: { "application/json": { schema: DecideApprovalRequestSchema } }, required: true },
  },
  responses: {
    200: json(ProposalSchema, "Decided."),
    401: json(ErrorResponseSchema, "No valid session."),
    403: json(ErrorResponseSchema, "Not an approver."),
    404: json(PurchasingErrorSchema, "No such approval in your organization."),
    409: json(
      PurchasingErrorSchema,
      "`INVALID_STATE` (already decided or cancelled), `HASH_MISMATCH` (not the proposal you reviewed), " +
        "`APPROVAL_EXPIRED` (not decided before the proposal's quote expiry) or `QUOTE_EXPIRED` " +
        "(the proposal's prices are older than 24 h); in the last two cases the buyer creates a new proposal.",
    ),
  },
});
