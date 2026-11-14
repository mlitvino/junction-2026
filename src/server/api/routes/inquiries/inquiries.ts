import "server-only";

import { createPriceAvailabilityInquiry } from "@/server/services/inquiry";
import { PriceAvailabilityInquirySchema } from "@/shared/contracts/catalog";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { createInquiryRoute } from "./inquiries.docs";

// Session required (default-deny in app.ts); roles per path. Separate statements: `.use()`/`.on()`
// return a plain Hono type, so chaining `.openapi()` after them doesn't type-check.
export const inquiriesRouter = createRouter();
inquiriesRouter.use("/inquiries", requireRole("buyer", "approver"));

inquiriesRouter.openapi(createInquiryRoute, async (c) => {
  const inquiry = await createPriceAvailabilityInquiry(c.req.valid("json"));
  return c.json(PriceAvailabilityInquirySchema.parse(inquiry), 200);
});
