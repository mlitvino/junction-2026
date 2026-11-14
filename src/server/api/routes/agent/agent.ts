import "server-only";

import { runPurchasingAgent } from "@/server/services/agent";
import { PurchasingError } from "@/server/services/purchasing";
import { AgentRunResponseSchema } from "@/shared/contracts/agent";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { postAgentRunRoute } from "./agent.docs";

// Session required (default-deny in app.ts); roles per path. Separate statements: `.use()`/`.on()`
// return a plain Hono type, so chaining `.openapi()` after them doesn't type-check.
export const agentRouter = createRouter();
agentRouter.use("/agent/*", requireRole("buyer"));

agentRouter.openapi(postAgentRunRoute, async (c) => {
  const actor = c.var.user;
  try {
    const result = await runPurchasingAgent(c.req.valid("json"), actor);
    return c.json(AgentRunResponseSchema.parse(result), 200);
  } catch (err) {
    if (!(err instanceof PurchasingError)) throw err;
    if (err.status === 400) return c.json({ error: err.message }, 400);
    if (err.status === 403) return c.json({ error: err.message }, 403);
    if (err.status === 404) return c.json({ error: err.message }, 404);
    return c.json({ error: err.message }, 409);
  }
});
