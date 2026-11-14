import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  CreateRecipeRequestSchema,
  RecipeListQuerySchema,
  RecipeListResponseSchema,
  RecipeSchema,
} from "@/shared/contracts/recipes";

export const listRecipesRoute = createRoute({
  method: "get",
  path: "/recipes",
  tags: ["Recipes"],
  summary: "List trusted Valio recipe book dishes and custom kitchen recipes",
  description:
    "Returns available recipes (including Traditional Finnish Creamy Salmon Soup / Lohikeitto) " +
    "with structured ingredient lists for recipe-to-order procurement.",
  request: {
    query: RecipeListQuerySchema,
  },
  responses: {
    200: {
      description: "Matching recipes.",
      content: { "application/json": { schema: RecipeListResponseSchema } },
    },
  },
});

export const getRecipeRoute = createRoute({
  method: "get",
  path: "/recipes/{recipeId}",
  tags: ["Recipes"],
  summary: "Get a single recipe and its base ingredient quantities",
  request: {
    params: z.object({
      recipeId: z.string().min(1).meta({ example: "recipe-salmon-soup" }),
    }),
  },
  responses: {
    200: {
      description: "Recipe detail.",
      content: { "application/json": { schema: RecipeSchema } },
    },
    404: {
      description: "Recipe not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const createRecipeRoute = createRoute({
  method: "post",
  path: "/recipes",
  tags: ["Recipes"],
  summary: "Save a custom customer dish recipe for future ordering",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateRecipeRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Created custom recipe.",
      content: { "application/json": { schema: RecipeSchema } },
    },
  },
});
