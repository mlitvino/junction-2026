import "server-only";

import { createRoute } from "@hono/zod-openapi";

import {
  CreateInquiryRequestSchema,
  PriceAvailabilityInquirySchema,
} from "@/shared/contracts/catalog";
import { ErrorResponseSchema } from "@/shared/contracts/errors";

export const createInquiryRoute = createRoute({
  method: "post",
  path: "/inquiries",
  tags: ["Inquiries"],
  summary: "Create a fixed-price and availability inquiry for narrowed-down products",
  description:
    "Confirms what quantities can be ordered and locks fixed unit prices (excl. and incl. VAT) " +
    "for 1–100 Valio Aimo products on the target delivery date before order commitment.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateInquiryRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Confirmed fixed-price and stock availability quote.",
      content: { "application/json": { schema: PriceAvailabilityInquirySchema } },
    },
    500: {
      description: "Inquiry failed.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
