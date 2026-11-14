import "server-only";

import { extractProductsFromPrompt } from "@/server/services/extract";
import { ExtractResponseSchema } from "@/shared/contracts/extract";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { postExtractRoute } from "./extract.docs";

// Session required (default-deny in app.ts); roles per path. Separate statements: `.use()`/`.on()`
// return a plain Hono type, so chaining `.openapi()` after them doesn't type-check.
export const extractRouter = createRouter();
extractRouter.use("/extract", requireRole("buyer", "approver"));

extractRouter.openapi(postExtractRoute, async (c) => {
  const result = await extractProductsFromPrompt(c.req.valid("json"));
  return c.json(ExtractResponseSchema.parse(result), 200);
});
