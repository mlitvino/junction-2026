import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  ProcurementSettingsSchema,
  UpdateProcurementSettingsRequestSchema,
} from "@/shared/contracts/guardrails";

export const getGuardrailsRoute = createRoute({
  method: "get",
  path: "/guardrails",
  tags: ["Guardrails"],
  summary: "Get active customer preferences and agent permission guardrails",
  description:
    "Returns dietary, allergen, and nutritional preferences alongside agent spending limits " +
    "and permitted/blocked product/category rules (scoped to the signed-in user's organization when authenticated).",
  responses: {
    200: {
      description: "Current procurement preferences and guardrails.",
      content: { "application/json": { schema: ProcurementSettingsSchema } },
    },
  },
});

export const putGuardrailsRoute = createRoute({
  method: "put",
  path: "/guardrails",
  tags: ["Guardrails"],
  summary: "Update customer preferences and agent permission guardrails",
  description:
    "Updates saved customer preferences and purchasing authority guardrails. When signed in, " +
    "only users holding the 'approver' role in their organization may modify these settings.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateProcurementSettingsRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated procurement preferences and guardrails.",
      content: { "application/json": { schema: ProcurementSettingsSchema } },
    },
    403: {
      description: "Signed-in user lacks the 'approver' role.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
