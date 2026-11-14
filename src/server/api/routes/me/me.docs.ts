import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import { MeResponseSchema } from "@/shared/contracts/me";

// OpenAPI definitions for the current-user routes. Handlers live in ./me.ts.

export const getMeRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Auth"],
  summary: "Current user",
  description:
    "Returns the signed-in user with their organization and roles (buyer, approver; a user can hold both). Requires a session cookie from `POST /api/auth/sign-in/username` (see /api/auth/reference).",
  security: [{ sessionCookie: [] }],
  responses: {
    200: {
      description: "The signed-in user.",
      content: { "application/json": { schema: MeResponseSchema } },
    },
    401: {
      description: "No valid session.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
