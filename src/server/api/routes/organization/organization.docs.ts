import "server-only";

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  CreateMemberRequestSchema,
  MemberSchema,
  MembersResponseSchema,
  UpdateRolesRequestSchema,
} from "@/shared/contracts/organization";

// OpenAPI definitions for organization member management. Handlers live in ./organization.ts.

const json = <T>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const AUTH_ERRORS = {
  401: json(ErrorResponseSchema, "No valid session."),
  403: json(ErrorResponseSchema, "The user is not an approver in their organization."),
};
const VALIDATION = json(z.object({ error: z.array(z.unknown()) }), "Invalid input (Zod issues).");
const APPROVER_ONLY = "Approver only. Works on the caller's own organization.";

export const listMembersRoute = createRoute({
  method: "get",
  path: "/organization/members",
  tags: ["Organization"],
  summary: "List members",
  description: `All users of the caller's organization with their roles. ${APPROVER_ONLY}`,
  security: [{ sessionCookie: [] }],
  responses: { 200: json(MembersResponseSchema, "The members."), ...AUTH_ERRORS },
});

export const createMemberRoute = createRoute({
  method: "post",
  path: "/organization/members",
  tags: ["Organization"],
  summary: "Create a member account",
  description: `Creates a login (username + password) inside the caller's organization with the given roles. The new user signs in with these credentials and belongs only to this organization. ${APPROVER_ONLY}`,
  security: [{ sessionCookie: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: CreateMemberRequestSchema } } },
  },
  responses: {
    201: json(MemberSchema, "The created member."),
    400: VALIDATION,
    ...AUTH_ERRORS,
    409: json(ErrorResponseSchema, "Username is already taken."),
  },
});

export const updateMemberRolesRoute = createRoute({
  method: "put",
  path: "/organization/members/{userId}/roles",
  tags: ["Organization"],
  summary: "Set a member's roles",
  description: `Replaces the member's roles. The organization must keep at least one approver, so removing the last approver's approver role (including your own) is refused. ${APPROVER_ONLY}`,
  security: [{ sessionCookie: [] }],
  request: {
    params: z.object({ userId: z.string().min(1).meta({ description: "User id of the member." }) }),
    body: { required: true, content: { "application/json": { schema: UpdateRolesRequestSchema } } },
  },
  responses: {
    200: json(MemberSchema, "The member with the new roles."),
    400: VALIDATION,
    ...AUTH_ERRORS,
    404: json(ErrorResponseSchema, "No such member in your organization."),
    409: json(ErrorResponseSchema, "The change would leave the organization without an approver."),
  },
});
