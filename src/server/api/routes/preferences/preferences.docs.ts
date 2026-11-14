import "server-only";

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  EffectiveResponseSchema,
  LayerSchema,
  LayerScopeSchema,
  LayersResponseSchema,
  UpdateLayerRequestSchema,
} from "@/shared/contracts/preferences";

// OpenAPI definitions for preferences. Handlers live in ./preferences.ts.

const json = <T>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const VALIDATION = json(z.object({ error: z.array(z.unknown()) }), "Invalid input (Zod issues).");
const SESSION_ERRORS = { 401: json(ErrorResponseSchema, "No valid session.") };
const APPROVER_ERRORS = {
  ...SESSION_ERRORS,
  403: json(ErrorResponseSchema, "The user is not an approver in their organization."),
};

const MODEL =
  "Preferences live in three layers per organization: `base` (everyone; can lock settings) and one per role, `buyer` and `approver`. " +
  "The effective value for a role is the role layer's value (unless the base locked it), else the base's, else the system default. " +
  "In a layer an absent key means inherit; `null` means no limit.";

export const getLayersRoute = createRoute({
  method: "get",
  path: "/preferences/layers",
  tags: ["Preferences"],
  summary: "Preference layers",
  description: `What each layer sets, plus the base layer's locks. Approver only. ${MODEL}`,
  security: [{ sessionCookie: [] }],
  responses: { 200: json(LayersResponseSchema, "The three layers."), ...APPROVER_ERRORS },
});

export const updateLayerRoute = createRoute({
  method: "put",
  path: "/preferences/layers/{scope}",
  tags: ["Preferences"],
  summary: "Replace a preference layer",
  description:
    "Replaces what the layer sets (settings you leave out inherit). Only `base` can lock settings; omit `locked` to keep the current locks. " +
    "A role layer can't set settings the base has locked (409), and the resulting effective settings of both roles must be valid, " +
    `e.g. autoApproveBelow ≤ maxOrderValue (422). Approver only. ${MODEL}`,
  security: [{ sessionCookie: [] }],
  request: {
    params: z.object({ scope: LayerScopeSchema }),
    body: { required: true, content: { "application/json": { schema: UpdateLayerRequestSchema } } },
  },
  responses: {
    200: json(LayerSchema, "The saved layer."),
    400: VALIDATION,
    ...APPROVER_ERRORS,
    409: json(ErrorResponseSchema, "The layer sets settings the organization has locked."),
    422: json(ErrorResponseSchema, "Not allowed: locks on a role layer, or an invalid combination of settings."),
  },
});

export const getEffectiveRoute = createRoute({
  method: "get",
  path: "/preferences/effective",
  tags: ["Preferences"],
  summary: "My effective preferences",
  description:
    "The settings that apply to the signed-in user, one entry per role they hold (a user with both roles gets both). " +
    `Each entry has the values, where every value comes from, and which settings are locked. ${MODEL}`,
  security: [{ sessionCookie: [] }],
  responses: { 200: json(EffectiveResponseSchema, "Effective settings per role."), ...SESSION_ERRORS },
});
