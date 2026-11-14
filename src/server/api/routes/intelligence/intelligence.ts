import "server-only";

import {
  checkRecurringOrderAnomalies,
  getProactiveRecommendations,
  getProactiveStockoutAlerts,
  IntelligenceServiceError,
} from "@/server/services/intelligence";
import {
  ProactiveRecommendationsResponseSchema,
  RecurringOrderCheckResponseSchema,
  StockoutAlertsResponseSchema,
} from "@/shared/contracts/intelligence";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  getProactiveRecommendationsRoute,
  getStockoutAlertsRoute,
  postRecurringOrderCheckRoute,
} from "./intelligence.docs";

// Session required (default-deny in app.ts); roles per path. Separate statements: `.use()`/`.on()`
// return a plain Hono type, so chaining `.openapi()` after them doesn't type-check.
export const intelligenceRouter = createRouter();
intelligenceRouter.use("/intelligence/*", requireRole("buyer", "approver"));

intelligenceRouter
  .openapi(getStockoutAlertsRoute, async (c) => {
    const actor = c.var.user;
    const { deliveryDate } = c.req.valid("query");
    const result = await getProactiveStockoutAlerts(deliveryDate, actor);
    return c.json(StockoutAlertsResponseSchema.parse(result), 200);
  })
  .openapi(postRecurringOrderCheckRoute, async (c) => {
    const actor = c.var.user;
    try {
      const result = await checkRecurringOrderAnomalies(c.req.valid("json"), actor);
      return c.json(RecurringOrderCheckResponseSchema.parse(result), 200);
    } catch (err) {
      if (err instanceof IntelligenceServiceError) {
        if (err.status === 400) return c.json({ error: err.message }, 400);
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  })
  .openapi(getProactiveRecommendationsRoute, async (c) => {
    const actor = c.var.user;
    const result = await getProactiveRecommendations(actor);
    return c.json(ProactiveRecommendationsResponseSchema.parse(result), 200);
  });
