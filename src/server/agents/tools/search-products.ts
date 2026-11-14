import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { searchCatalogProducts } from "@/server/services/inquiry";
import { CatalogSearchResponseSchema } from "@/shared/contracts/catalog";

export const searchProductsTool = createTool({
  id: "search-products",
  description:
    "Search the Valio Aimo product catalog by free-text query, category, excluded allergens, and dietary tags. Always narrow down products here before calling inquire-price-availability.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Free-text search terms, e.g. 'creamy cheese' or 'lactose-free milk'."),
    category: z.string().optional().describe("Optional category filter, e.g. 'CHEESE' or 'MILK'."),
    excludeAllergens: z
      .string()
      .optional()
      .describe("Optional comma-separated allergens to exclude, e.g. 'soy,tree-nuts'."),
    dietary: z
      .string()
      .optional()
      .describe("Optional comma-separated required dietary tags, e.g. 'vegetarian,gluten-free'."),
    limit: z.number().int().min(1).max(50).default(15),
  }),
  outputSchema: CatalogSearchResponseSchema,
  execute: async ({ query, category, excludeAllergens, dietary, limit }) =>
    searchCatalogProducts({
      q: query,
      category,
      excludeAllergens,
      dietary,
      limit: limit ?? 15,
      offset: 0,
    }),
});
