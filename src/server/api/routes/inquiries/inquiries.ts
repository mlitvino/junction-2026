import "server-only";

import { createPriceAvailabilityInquiry } from "@/server/services/inquiry";
import { PriceAvailabilityInquirySchema } from "@/shared/contracts/catalog";

import { createRouter } from "../../router";
import { createInquiryRoute } from "./inquiries.docs";

export const inquiriesRouter = createRouter().openapi(createInquiryRoute, async (c) => {
  const inquiry = await createPriceAvailabilityInquiry(c.req.valid("json"));
  return c.json(PriceAvailabilityInquirySchema.parse(inquiry), 200);
});
