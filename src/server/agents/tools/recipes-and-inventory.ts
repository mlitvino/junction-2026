import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { listInventory } from "@/server/services/inventory";
import { createOrderFromRecipe, listRecipes } from "@/server/services/recipes";
import { InventoryListResponseSchema } from "@/shared/contracts/inventory";
import type { SessionUser } from "@/shared/contracts/me";
import {
  CreateOrderFromRecipeResponseSchema,
  RecipeListResponseSchema,
} from "@/shared/contracts/recipes";

export const listRecipesTool = createTool({
  id: "list-recipes",
  description:
    "Search or list trusted Valio recipe book dishes (such as Traditional Finnish Creamy Salmon Soup / Lohikeitto) and custom kitchen recipes.",
  inputSchema: z.object({
    query: z.string().optional().describe("Optional dish or ingredient search query."),
    tag: z.string().optional().describe("Optional recipe tag filter."),
  }),
  outputSchema: RecipeListResponseSchema,
  execute: async ({ query, tag }, context) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return listRecipes({ q: query, tag }, actor);
  },
});

export const getInventoryTool = createTool({
  id: "get-kitchen-inventory",
  description:
    "Inspect current customer kitchen/canteen ingredient stock levels and par levels before ordering.",
  inputSchema: z.object({}),
  outputSchema: InventoryListResponseSchema,
  execute: async (_input, context) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return listInventory(actor);
  },
});

export const createOrderFromRecipeTool = createTool({
  id: "create-order-from-recipe",
  description:
    "Translate a dish recipe (by recipeId or dishQuery like 'salmon soup') into aggregated ingredient needs, subtract existing kitchen inventory stock, and run the full Valio Aimo procurement pipeline for the remainder.",
  inputSchema: z.object({
    recipeId: z.string().optional().describe("Recipe ID such as 'recipe-salmon-soup'."),
    dishQuery: z
      .string()
      .optional()
      .describe("Dish name such as 'salmon soup' when recipeId is omitted."),
    servings: z
      .number()
      .positive()
      .optional()
      .describe("Desired number of servings to scale the recipe for."),
    deliveryDate: z.string().optional().describe("Optional YYYY-MM-DD delivery date."),
    budgetEur: z.number().positive().optional().describe("Optional budget override in EUR."),
    autoResolvePartialStock: z
      .boolean()
      .optional()
      .describe("If true, splits insufficient-stock items across allergen-safe substitutes."),
  }),
  outputSchema: CreateOrderFromRecipeResponseSchema,
  execute: async (
    { recipeId, dishQuery, servings, deliveryDate, budgetEur, autoResolvePartialStock },
    context,
  ) => {
    const actor = context?.requestContext?.get("actor") as SessionUser | null | undefined;
    return createOrderFromRecipe(
      {
        recipeId,
        dishQuery,
        servings,
        deliveryDate,
        budgetEur,
        autoResolvePartialStock,
      },
      actor,
    );
  },
});
