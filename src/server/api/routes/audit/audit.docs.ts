import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import { AuditListSchema, AuditQuerySchema } from "@/shared/contracts/purchasing";

// OpenAPI definitions for the organization's audit log. Handlers live in ./audit.ts.

export const listAuditRoute = createRoute({
  method: "get",
  path: "/audit",
  tags: ["Audit"],
  summary: "Organization audit log",
  description:
    "Insert-only record of who did what and why: proposals (incl. the agent's selection steps and policy " +
    "reasons), approvals, orders and refused orders, preference and member changes. Newest first. Approvers only; " +
    "filter by `resourceType` and `resourceId`. Per proposal: GET /proposals/{id}/audit (any member).",
  security: [{ sessionCookie: [] }],
  request: { query: AuditQuerySchema },
  responses: {
    200: { description: "Events.", content: { "application/json": { schema: AuditListSchema } } },
    401: { description: "No valid session.", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Not an approver.", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});
