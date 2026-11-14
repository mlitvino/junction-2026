import "server-only";

import { extractProductsFromPrompt } from "@/server/services/extract";
import { ExtractResponseSchema } from "@/shared/contracts/extract";

import { createRouter } from "../../router";
import { postExtractRoute } from "./extract.docs";

export const extractRouter = createRouter().openapi(postExtractRoute, async (c) => {
  const result = await extractProductsFromPrompt(c.req.valid("json"));
  return c.json(ExtractResponseSchema.parse(result), 200);
});
