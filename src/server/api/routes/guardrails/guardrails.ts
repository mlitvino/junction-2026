import "server-only";

import {
  getProcurementSettings,
  ProcurementPermissionError,
  updateProcurementSettings,
} from "@/server/services/guardrails";
import { ProcurementSettingsSchema } from "@/shared/contracts/guardrails";

import { resolveOptionalUser } from "../../middleware/session";
import { createRouter } from "../../router";
import { getGuardrailsRoute, putGuardrailsRoute } from "./guardrails.docs";

export const guardrailsRouter = createRouter()
  .openapi(getGuardrailsRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const settings = await getProcurementSettings(actor);
    return c.json(ProcurementSettingsSchema.parse(settings), 200);
  })
  .openapi(putGuardrailsRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    try {
      const updated = await updateProcurementSettings(actor, c.req.valid("json"));
      return c.json(ProcurementSettingsSchema.parse(updated), 200);
    } catch (err) {
      if (err instanceof ProcurementPermissionError) {
        return c.json({ error: err.message }, 403);
      }
      throw err;
    }
  });
