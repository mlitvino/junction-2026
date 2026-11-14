import "server-only";

import { runPurchasingAgent } from "@/server/services/agent";
import { OrderServiceError } from "@/server/services/orders";
import { AgentRunResponseSchema } from "@/shared/contracts/agent";

import { resolveOptionalUser } from "../../middleware/session";
import { createRouter } from "../../router";
import { postAgentRunRoute } from "./agent.docs";

export const agentRouter = createRouter().openapi(postAgentRunRoute, async (c) => {
  const actor = await resolveOptionalUser(c.req.raw.headers);
  try {
    const result = await runPurchasingAgent(c.req.valid("json"), actor);
    return c.json(AgentRunResponseSchema.parse(result), 200);
  } catch (err) {
    if (!(err instanceof OrderServiceError)) throw err;
    if (err.status === 400) return c.json({ error: err.message }, 400);
    if (err.status === 404) return c.json({ error: err.message }, 404);
    return c.json({ error: err.message }, 409);
  }
});
