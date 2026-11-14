import "server-only";

import { createRecipe, getRecipeById, listRecipes } from "@/server/services/recipes";
import { RecipeListResponseSchema, RecipeSchema } from "@/shared/contracts/recipes";

import { resolveOptionalUser } from "../../middleware/session";
import { createRouter } from "../../router";
import { createRecipeRoute, getRecipeRoute, listRecipesRoute } from "./recipes.docs";

export const recipesRouter = createRouter()
  .openapi(listRecipesRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const result = await listRecipes(c.req.valid("query"), actor);
    return c.json(RecipeListResponseSchema.parse(result), 200);
  })
  .openapi(getRecipeRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const recipe = await getRecipeById(c.req.valid("param").recipeId, actor);
    if (!recipe) return c.json({ error: "Recipe not found" }, 404);
    return c.json(RecipeSchema.parse(recipe), 200);
  })
  .openapi(createRecipeRoute, async (c) => {
    const actor = await resolveOptionalUser(c.req.raw.headers);
    const created = await createRecipe(c.req.valid("json"), actor);
    return c.json(RecipeSchema.parse(created), 200);
  });
