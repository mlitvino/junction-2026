import "server-only";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// MOCK: fixed fake data. Replace with a call to the Valio Aimo mock API later.
export const searchProductsTool = createTool({
  id: "search-products",
  description: "Search the (mock) product catalog by free-text query.",
  inputSchema: z.object({
    query: z.string().describe("What to look for, e.g. 'lactose-free milk'"),
  }),
  outputSchema: z.object({
    products: z.array(
      z.object({
        sku: z.string(),
        name: z.string(),
        unitPriceEur: z.number(),
        inStock: z.boolean(),
      }),
    ),
  }),
  execute: async ({ query }) => ({
    products: [
      { sku: "MOCK-001", name: `Mock result for "${query}"`, unitPriceEur: 1.29, inStock: true },
    ],
  }),
});
