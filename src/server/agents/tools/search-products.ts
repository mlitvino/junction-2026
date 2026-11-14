import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { searchProducts } from "@/server/services/catalog";
import { ProductSearchResponseSchema } from "@/shared/contracts/products";

export const searchProductsTool = createTool({
  id: "search-products",
  description:
    "Search the Valio Aimo catalog (real data, no prices): words, category, allergens to exclude (names or GS1 codes), required dietary tags, origin, CO2 and reliability limits, vendor, brand, label; sort by name, CO2 or reliability. Each result shows its content per sales unit (e.g. 5 L per case). Narrow down here before asking prices or ranking.",
  inputSchema: z.object({
    query: z.string().optional().describe("Words to find, e.g. 'lactose-free milk'."),
    category: z.string().optional(),
    excludeAllergens: z.string().optional().describe("Comma-separated, e.g. 'milk,soy' or 'AM,AY'."),
    excludeMayContain: z.boolean().optional().describe("Also exclude 'may contain' traces."),
    dietary: z.string().optional().describe("Comma-separated: lactose-free, gluten-free, vegan, vegetarian."),
    origin: z.string().optional().describe("Comma-separated ISO countries, e.g. 'fi'."),
    maxCo2PerKg: z.number().positive().optional(),
    minReliability: z.number().min(0).max(1).optional(),
    vendor: z.string().optional(),
    brand: z.string().optional(),
    label: z.string().optional().describe("Label id, e.g. EU_ORGANIC_FARMING."),
    sort: z.enum(["name", "co2", "reliability"]).optional(),
    limit: z.number().int().min(1).max(50).default(15),
  }),
  outputSchema: ProductSearchResponseSchema,
  execute: async ({ query, excludeMayContain, sort, limit, ...filters }) =>
    searchProducts({
      ...filters,
      q: query,
      excludeMayContain: excludeMayContain ? "true" : undefined,
      sort: sort ?? "name",
      limit: limit ?? 15,
      offset: 0,
    }),
});
