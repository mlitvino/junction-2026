import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getProduct } from "@/server/services/catalog";
import { ProductDetailSchema } from "@/shared/contracts/products";

export const getProductDetailsTool = createTool({
  id: "get-product-details",
  description:
    "Product details by Valio code: units and content per sales unit, allergens (contains / may contain), dietary tags, declared nutrition per 100 g/ml, labels, CO2 per kg, delivery reliability and Valio's suggested substitutes.",
  inputSchema: z.object({
    productId: z.string().describe("Valio product code, e.g. '469330'."),
  }),
  outputSchema: z.object({ found: z.boolean(), product: ProductDetailSchema.nullable() }),
  execute: async ({ productId }) => {
    const product = await getProduct(productId);
    return { found: Boolean(product), product };
  },
});
