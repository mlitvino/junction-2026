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

import { resolveOptionalUser } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  getProactiveRecommendationsRoute,
  getStockoutAlertsRoute,
  postRecurringOrderCheckRoute,
} from "./intelligence.docs";

export const intelligenceRouter = createRouter()
  .openapi(getStockoutAlertsRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const { deliveryDate } = c.req.valid("query");
    const result = await getProactiveStockoutAlerts(deliveryDate, actor);
    return c.json(StockoutAlertsResponseSchema.parse(result), 200);
  })
  .openapi(postRecurringOrderCheckRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
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
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const result = await getProactiveRecommendations(actor);
    return c.json(ProactiveRecommendationsResponseSchema.parse(result), 200);
  });
