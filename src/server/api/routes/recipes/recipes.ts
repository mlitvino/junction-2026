import "server-only";

import { createRecipe, getRecipeById, listRecipes } from "@/server/services/recipes";
import { RecipeListResponseSchema, RecipeSchema } from "@/shared/contracts/recipes";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { createRecipeRoute, getRecipeRoute, listRecipesRoute } from "./recipes.docs";

// Session required (default-deny in app.ts); roles per path. Separate statements: `.use()`/`.on()`
// return a plain Hono type, so chaining `.openapi()` after them doesn't type-check.
export const recipesRouter = createRouter();
recipesRouter.on("GET", "/recipes", requireRole("buyer", "approver"));
recipesRouter.on("GET", "/recipes/:recipeId", requireRole("buyer", "approver"));
recipesRouter.on("POST", "/recipes", requireRole("buyer"));

recipesRouter
  .openapi(listRecipesRoute, async (c) => {
    const actor = c.var.user;
    const result = await listRecipes(c.req.valid("query"), actor);
    return c.json(RecipeListResponseSchema.parse(result), 200);
  })
  .openapi(getRecipeRoute, async (c) => {
    const actor = c.var.user;
    const recipe = await getRecipeById(c.req.valid("param").recipeId, actor);
    if (!recipe) return c.json({ error: "Recipe not found" }, 404);
    return c.json(RecipeSchema.parse(recipe), 200);
  })
  .openapi(createRecipeRoute, async (c) => {
    const actor = c.var.user;
    const created = await createRecipe(c.req.valid("json"), actor);
    return c.json(RecipeSchema.parse(created), 200);
  });
