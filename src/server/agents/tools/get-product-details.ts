import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getCatalogProductDetail } from "@/server/services/inquiry";
import { CatalogProductDetailSchema } from "@/shared/contracts/catalog";

export const getProductDetailsTool = createTool({
  id: "get-product-details",
  description:
    "Fetch detailed Valio Aimo product metadata by SKU/productId, including allergens, dietary tags, nutritional profile per 100g, CO2 per kg, delivery reliability, and suggested substitute products.",
  inputSchema: z.object({
    productId: z.string().describe("Valio product code, e.g. '460101'."),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    product: CatalogProductDetailSchema.nullable(),
  }),
  execute: async ({ productId }) => {
    const product = await getCatalogProductDetail(productId);
    return {
      found: Boolean(product),
      product,
    };
  },
});
