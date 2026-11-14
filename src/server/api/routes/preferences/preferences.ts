import "server-only";

import { PreferencesError, getEffective, getLayers, updateLayer } from "@/server/services/preferences";
import { EffectiveResponseSchema, LayerSchema, LayersResponseSchema } from "@/shared/contracts/preferences";

import { requireRole, requireSession } from "../../middleware/session";
import { createRouter } from "../../router";
import { getEffectiveRoute, getLayersRoute, updateLayerRoute } from "./preferences.docs";

export const preferencesRouter = createRouter();

// Editing is for approvers; reading your own effective settings needs only a session. Separate
// statements: `.use()` returns a plain Hono type, so chaining `.openapi()` after it doesn't type-check.
preferencesRouter.use("/preferences/layers/*", requireRole("approver"));
preferencesRouter.use("/preferences/effective", requireSession);

preferencesRouter
  .openapi(getLayersRoute, async (c) =>
    c.json(LayersResponseSchema.parse(await getLayers(c.var.user.organization.id)), 200),
  )
  .openapi(updateLayerRoute, async (c) => {
    try {
      const layer = await updateLayer(
        c.var.user.organization.id,
        c.var.user.id,
        c.req.valid("param").scope,
        c.req.valid("json"),
      );
      return c.json(LayerSchema.parse(layer), 200);
    } catch (err) {
      if (!(err instanceof PreferencesError)) throw err;
      return err.status === 409 ? c.json({ error: err.message }, 409) : c.json({ error: err.message }, 422);
    }
  })
  .openapi(getEffectiveRoute, async (c) => {
    const { organization, roles } = c.var.user;
    return c.json(EffectiveResponseSchema.parse(await getEffective(organization.id, roles)), 200);
  });
