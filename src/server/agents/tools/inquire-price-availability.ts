import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { createPriceAvailabilityInquiry } from "@/server/services/inquiry";
import {
  InquiryItemRequestSchema,
  PriceAvailabilityInquirySchema,
} from "@/shared/contracts/catalog";

export const inquirePriceAvailabilityTool = createTool({
  id: "inquire-price-availability",
  description:
    "Run a fixed-price and stock availability inquiry for 1–50 narrowed-down Valio Aimo product IDs and desired quantities before placing or modifying an order.",
  inputSchema: z.object({
    items: z
      .array(InquiryItemRequestSchema)
      .min(1)
      .max(50)
      .describe("Products and quantities to inquire about."),
    deliveryDate: z.string().optional().describe("Optional delivery date in YYYY-MM-DD format."),
  }),
  outputSchema: PriceAvailabilityInquirySchema,
  execute: async ({ items, deliveryDate }) =>
    createPriceAvailabilityInquiry({
      items,
      deliveryDate,
    }),
});
