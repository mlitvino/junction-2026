import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { searchProducts } from "@/server/services/catalog";
import { actorFor } from "@/server/services/purchasing";
import { rankProducts } from "@/server/services/selection";
import { ProductSearchResponseSchema, RankProductsResponseSchema } from "@/shared/contracts/products";

import { toolActor } from "./actor";

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

export const rankProductsTool = createTool({
  id: "rank-products",
  description:
    "Good / better / best for a need, e.g. 1000 L of lactose-free milk by a date: applies the organization's allergen, dietary and vendor rules, converts the amount into each product's sales units, asks Valio prices and availability, and ranks by price per litre/kg, availability, reliability, CO2 and preferences with reasons.",
  inputSchema: z.object({
    q: z.string().optional().describe("What is needed, e.g. 'lactose-free milk'."),
    productIds: z.array(z.string()).max(20).optional(),
    quantity: z.number().positive(),
    unit: z.string().optional().describe("L, kg, cases, pcs … (empty = sales units)."),
    date: z.string().optional().describe("Delivery date, YYYY-MM-DD."),
  }),
  outputSchema: RankProductsResponseSchema,
  execute: async (input, context) =>
    rankProducts(actorFor(toolActor(context), true), { ...input, limit: 10 }),
});
