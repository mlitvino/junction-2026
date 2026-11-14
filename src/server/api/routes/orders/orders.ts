import "server-only";

import { createOrderFromPrompt } from "@/server/services/orders";
import { CreateOrderFromPromptResponseSchema } from "@/shared/contracts/orders";

import { createRouter } from "../../router";
import { postOrdersRoute } from "./orders.docs";

export const ordersRouter = createRouter().openapi(postOrdersRoute, async (c) => {
  const result = await createOrderFromPrompt(c.req.valid("json"));
  return c.json(CreateOrderFromPromptResponseSchema.parse(result), 200);
});
