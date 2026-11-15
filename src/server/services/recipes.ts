import "server-only";

import { randomUUID } from "node:crypto";

import { asc, eq, isNull, or } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { procurementRecipe } from "@/server/db/schema";
import { makeStep, stepDetails } from "@/server/purchasing/story";
import { todayIsoDate } from "@/server/services/inquiry";
import {
  listInventory,
  normalizeQuantityAndUnit,
  reconcileRecipeIngredientsWithInventory,
  roundQuantity,
} from "@/server/services/inventory";
import { actorFor } from "@/server/services/purchasing";
import { computeNameMatchScore, createProposalFromItems } from "@/server/services/selection";
import type { ExtractedProductItem } from "@/shared/contracts/extract";
import type { InventoryItem } from "@/shared/contracts/inventory";
import type { SessionUser } from "@/shared/contracts/me";
import {
  type CreateOrderFromRecipeRequest,
  type CreateOrderFromRecipeResponse,
  type CreateRecipeRequest,
  type Recipe,
  RecipeIngredientSchema,
  type RecipeListQuery,
  type RecipeListResponse,
} from "@/shared/contracts/recipes";
import { z } from "zod";

export class RecipeServiceError extends Error {
  readonly status: 400 | 404;
  constructor(message: string, status: 400 | 404) {
    super(message);
    this.name = "RecipeServiceError";
    this.status = status;
  }
}

const DEFAULT_RECIPE_TIMESTAMP = "2026-11-14T08:00:00.000Z";

export const DEFAULT_VALIO_RECIPES: Recipe[] = [
  {
    id: "recipe-salmon-soup",
    organizationId: null,
    name: "Traditional Finnish Creamy Salmon Soup (Lohikeitto)",
    source: "valio_recipe_book",
    description:
      "Classic Nordic creamy salmon soup prepared with diced Finnish potatoes, sautéed leek, carrots, unsalted butter, lactose-free cooking cream, and fresh dill.",
    baseServings: 10,
    ingredients: [
      {
        productName: "Salmon fillet",
        productType: "Fish",
        quantity: 1.8,
        unit: "KG",
        notes: "Skinless cubed fillet",
      },
      {
        productName: "Diced potatoes",
        productType: "Potato",
        quantity: 2.5,
        unit: "KG",
        notes: "Peeled soup potatoes",
      },
      {
        productName: "Cooking cream",
        productType: "Cream",
        quantity: 1.0,
        unit: "L",
        notes: "Lactose-free cooking cream",
      },
      {
        productName: "Unsalted butter",
        productType: "Butter",
        quantity: 150,
        unit: "G",
        notes: "For sautéing sliced leek",
      },
      {
        productName: "Unsalted butter",
        productType: "Butter",
        quantity: 50,
        unit: "G",
        notes: "Finishing butter before service",
      },
      {
        productName: "Sliced leek",
        productType: "Vegetables",
        quantity: 0.4,
        unit: "KG",
      },
      {
        productName: "Diced carrots",
        productType: "Vegetables",
        quantity: 0.5,
        unit: "KG",
      },
      {
        productName: "Fresh dill",
        productType: "Herbs",
        quantity: 0.1,
        unit: "KG",
        notes: "Finely chopped garnish",
      },
    ],
    instructions:
      "1. Sauté sliced leek in 150 g unsalted butter. 2. Add water/broth, diced potatoes, and carrots; simmer 12 min. 3. Add cubed salmon fillet and cooking cream; simmer gently 5 min. 4. Finish with 50 g butter and chopped fresh dill.",
    tags: ["salmon-soup", "lohikeitto", "soup", "nordic", "lunch", "canteen"],
    updatedAt: DEFAULT_RECIPE_TIMESTAMP,
  },
  {
    id: "recipe-creamy-potato-gratin",
    organizationId: null,
    name: "Valio Creamy Cheese & Potato Canteen Bake",
    source: "valio_recipe_book",
    description:
      "Rich oven-baked Finnish potato gratin layered with creamy cheese, lactose-free cooking cream, and butter.",
    baseServings: 20,
    ingredients: [
      {
        productName: "Creamy cheese",
        productType: "Cheese",
        quantity: 2.0,
        unit: "KG",
      },
      {
        productName: "Diced potatoes",
        productType: "Potato",
        quantity: 6.0,
        unit: "KG",
      },
      {
        productName: "Cooking cream",
        productType: "Cream",
        quantity: 2.0,
        unit: "L",
      },
      {
        productName: "Unsalted butter",
        productType: "Butter",
        quantity: 300,
        unit: "G",
      },
    ],
    instructions:
      "Layer potatoes and creamy cheese in GN pans, pour over seasoned cooking cream, dot with butter, and bake at 175°C for 55 minutes.",
    tags: ["gratin", "potato", "cheese", "vegetarian", "canteen"],
    updatedAt: DEFAULT_RECIPE_TIMESTAMP,
  },
  {
    id: "recipe-cloudberry-quark-breakfast",
    organizationId: null,
    name: "Nordic School Canteen Milk & Cloudberry Quark Bowl",
    source: "valio_recipe_book",
    description:
      "High-protein lactose-free Nordic breakfast or snack pairing seasonal Lapland cloudberry quark with fresh milk.",
    baseServings: 25,
    ingredients: [
      {
        productName: "Lactose-free semi-skimmed milk",
        productType: "Milk",
        quantity: 5.0,
        unit: "L",
      },
      {
        productName: "Lapland cloudberry quark",
        productType: "Yogurt",
        quantity: 2.5,
        unit: "KG",
      },
    ],
    instructions: "Serve chilled quark portions alongside fresh lactose-free milk.",
    tags: ["breakfast", "snack", "seasonal", "school"],
    updatedAt: DEFAULT_RECIPE_TIMESTAMP,
  },
];

const fallbackCustomRecipes = new Map<string, Recipe>();

function rowToRecipe(row: typeof procurementRecipe.$inferSelect): Recipe | null {
  const parsedIngredients = z.array(RecipeIngredientSchema).safeParse(row.ingredients);
  if (!parsedIngredients.success) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    source: row.source === "valio_recipe_book" ? "valio_recipe_book" : "customer",
    description: row.description,
    baseServings: row.baseServings,
    ingredients: parsedIngredients.data,
    instructions: row.instructions,
    tags: Array.isArray(row.tags) ? row.tags : [],
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadAllAccessibleRecipes(actor: SessionUser): Promise<Recipe[]> {
  const orgId = actor?.organization.id ?? null;
  const byId = new Map<string, Recipe>();

  for (const builtIn of DEFAULT_VALIO_RECIPES) {
    byId.set(builtIn.id, structuredClone(builtIn));
  }

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      const rows = orgId
        ? await db
            .select()
            .from(procurementRecipe)
            .where(
              or(
                isNull(procurementRecipe.organizationId),
                eq(procurementRecipe.organizationId, orgId),
              ),
            )
            .orderBy(asc(procurementRecipe.name))
        : await db
            .select()
            .from(procurementRecipe)
            .where(isNull(procurementRecipe.organizationId))
            .orderBy(asc(procurementRecipe.name));

      for (const r of rows) {
        const mapped = rowToRecipe(r);
        if (mapped) byId.set(mapped.id, mapped);
      }
    } catch {
      // Fall through to in-memory recipes when DB is unreachable.
    }
  }

  for (const mem of fallbackCustomRecipes.values()) {
    if (mem.organizationId === null || mem.organizationId === orgId) {
      byId.set(mem.id, structuredClone(mem));
    }
  }

  return [...byId.values()];
}

/** Lists trusted Valio recipes and customer-created recipes matching optional search filters. */
export async function listRecipes(
  query: RecipeListQuery = {},
  actor: SessionUser,
): Promise<RecipeListResponse> {
  const all = await loadAllAccessibleRecipes(actor);
  const qNorm = query.q?.trim().toLowerCase();
  const tagNorm = query.tag?.trim().toLowerCase();

  const filtered = all.filter((recipe) => {
    if (tagNorm && !recipe.tags.some((t) => t.toLowerCase().includes(tagNorm))) {
      return false;
    }
    if (qNorm) {
      const haystack = [
        recipe.id,
        recipe.name,
        recipe.description ?? "",
        ...recipe.tags,
        ...recipe.ingredients.map((i) => `${i.productName} ${i.productType}`),
      ]
        .join(" ")
        .toLowerCase();
      const tokens = qNorm.split(/\s+/).filter(Boolean);
      if (!tokens.every((t) => haystack.includes(t))) {
        return false;
      }
    }
    return true;
  });

  return { recipes: filtered };
}

/** Retrieves a single recipe by ID if accessible to the caller. */
export async function getRecipeById(
  recipeId: string,
  actor: SessionUser,
): Promise<Recipe | null> {
  const all = await loadAllAccessibleRecipes(actor);
  return all.find((r) => r.id.toLowerCase() === recipeId.trim().toLowerCase()) ?? null;
}

/** Resolves the best-matching recipe for a natural-language dish query (e.g. 'salmon soup', 'lohikeitto'). */
export async function findRecipeByDishQuery(
  dishQuery: string,
  actor: SessionUser,
): Promise<Recipe | null> {
  const cleaned = dishQuery
    .replace(
      /\b(order|buy|make|cook|prepare|ingredients?|products?|recipe|receipt|for|servings?|portions?|people|persons?|batches?|\d+)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  const target = cleaned || dishQuery.trim();
  if (!target) return null;

  const all = await loadAllAccessibleRecipes(actor);
  const exact = all.find(
    (r) =>
      r.id.toLowerCase() === target.toLowerCase() ||
      r.name.toLowerCase() === target.toLowerCase() ||
      r.tags.some((t) => t.toLowerCase() === target.toLowerCase().replace(/\s+/g, "-")),
  );
  if (exact) return exact;

  let best: { recipe: Recipe; score: number } | null = null;
  for (const recipe of all) {
    const score = Math.max(
      computeNameMatchScore(target, recipe.name),
      ...recipe.tags.map((t) => computeNameMatchScore(target, t.replace(/-/g, " "))),
    );
    if (score > (best?.score ?? 0.3)) {
      best = { recipe, score };
    }
  }
  return best?.recipe ?? null;
}

/** Creates and persists a custom customer recipe scoped to the caller's organization. */
export async function createRecipe(
  input: CreateRecipeRequest,
  actor: SessionUser,
): Promise<Recipe> {
  const orgId = actor?.organization.id ?? null;
  const now = new Date();
  const id = `recipe-${randomUUID().slice(0, 8).toLowerCase()}`;

  const recipe: Recipe = {
    id,
    organizationId: orgId,
    name: input.name.trim(),
    source: "customer",
    description: input.description?.trim() ?? null,
    baseServings: input.baseServings,
    ingredients: input.ingredients,
    instructions: input.instructions?.trim() ?? null,
    tags: input.tags ?? [],
    updatedAt: now.toISOString(),
  };

  fallbackCustomRecipes.set(id, recipe);

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabase();
      const db = getDb();
      await db.insert(procurementRecipe).values({
        id: recipe.id,
        organizationId: orgId,
        name: recipe.name,
        source: recipe.source,
        description: recipe.description,
        baseServings: recipe.baseServings,
        ingredients: recipe.ingredients as unknown as Array<Record<string, unknown>>,
        instructions: recipe.instructions,
        tags: recipe.tags,
        createdByUserId: actor?.id ?? null,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Keep in-memory recipe when DB is unavailable.
    }
  }

  return recipe;
}

/**
 * User Story 2 & Optional Feature #9: End-to-End Recipe-to-Order Workflow (Steps 1–9).
 * 1. Query recipe ingredients in `[Product name] - [Product type] - [Quantity]` format.
 * 2. Aggregate total quantity for each ingredient across duplicate lines & scale by servings/batches.
 * 3. Subtract customer inventory stock: `actuallyNeeded = max(0, totalNeeded - inventoryStock)`.
 * 4. Select products for what is still needed and create a proposal (services/selection.ts), which
 *    the purchasing flow prices, checks against the organization's rules and sends for approval.
 */
export async function createProposalFromRecipe(
  input: CreateOrderFromRecipeRequest,
  actor: SessionUser,
  viaAgent = false,
): Promise<CreateOrderFromRecipeResponse> {
  let recipe: Recipe | null = null;

  if (input.customRecipe) {
    recipe = {
      id: `recipe-inline-${randomUUID().slice(0, 6).toLowerCase()}`,
      organizationId: actor?.organization.id ?? null,
      name: input.customRecipe.name,
      source: "customer",
      description: "Inline customer-provided recipe",
      baseServings: input.customRecipe.baseServings,
      ingredients: input.customRecipe.ingredients,
      instructions: null,
      tags: ["custom"],
      updatedAt: new Date().toISOString(),
    };
  } else if (input.recipeId) {
    recipe = await getRecipeById(input.recipeId, actor);
    if (!recipe) {
      throw new RecipeServiceError(`Recipe '${input.recipeId}' not found.`, 404);
    }
  } else if (input.dishQuery) {
    recipe = await findRecipeByDishQuery(input.dishQuery, actor);
    if (!recipe) {
      throw new RecipeServiceError(
        `No matching recipe found for dish '${input.dishQuery}'.`,
        404,
      );
    }
  } else {
    throw new RecipeServiceError(
      "Provide one of 'recipeId', 'dishQuery', or 'customRecipe' to create a recipe-based order.",
      400,
    );
  }

  const scaleFactor =
    input.servings !== undefined
      ? roundQuantity(input.servings / recipe.baseServings)
      : roundQuantity(input.batchMultiplier ?? 1);
  const requestedServings =
    input.servings !== undefined
      ? input.servings
      : roundQuantity(recipe.baseServings * scaleFactor);

  // Load customer kitchen inventory (override or saved/mock org inventory)
  const nowIso = new Date().toISOString();
  const inventoryUsed: InventoryItem[] = input.inventoryOverride
    ? input.inventoryOverride.map((it, idx) => {
        const norm = normalizeQuantityAndUnit(it.quantityInStock, it.unit);
        return {
          id: it.id ?? `inv-override-${idx + 1}`,
          organizationId: actor?.organization.id ?? null,
          ingredientName: it.ingredientName,
          productType: it.productType,
          linkedProductId: it.linkedProductId ?? null,
          quantityInStock: norm.quantity,
          unit: norm.unit,
          minParLevel: it.minParLevel ?? null,
          location: it.location ?? null,
          updatedAt: nowIso,
        };
      })
    : (await listInventory(actor)).items;

  // Steps 2 & 3: Aggregate total needed quantities and subtract customer inventory stock
  const ingredientReconciliation = reconcileRecipeIngredientsWithInventory({
    ingredients: recipe.ingredients,
    scaleFactor,
    inventory: inventoryUsed,
  });

  const extractedItems: ExtractedProductItem[] = ingredientReconciliation
    .filter((rec) => rec.actuallyNeededQuantity > 0)
    .map((rec) => ({
      productName: rec.productName,
      productType: rec.productType,
      productQuantity: `${rec.actuallyNeededQuantity} ${rec.normalizedUnit}`,
    }));

  const deliveryDate = input.deliveryDate ?? todayIsoDate();
  const coveredCount = ingredientReconciliation.filter((r) => r.coveredByInventory).length;
  const readSummary = `Loaded recipe '${recipe.name}' (${recipe.id}, ${recipe.source}) for ${requestedServings} servings (${scaleFactor}x the base ${recipe.baseServings}): ${recipe.ingredients
    .map((i) => `${i.productName} - ${i.productType} - ${i.quantity} ${i.unit}`)
    .join("; ")}.`;
  const totalSummary = `Calculated the total quantity of ${ingredientReconciliation.length} ingredient(s) for ${requestedServings} servings: ${ingredientReconciliation
    .map((r) => `${r.productName} ${r.totalNeededQuantity} ${r.normalizedUnit}`)
    .join("; ")}.`;
  const inventorySummary = `Checked ${ingredientReconciliation.length} ingredient(s) against kitchen stock: ${extractedItems.length} to order, ${coveredCount} covered by stock. ${ingredientReconciliation
    .map((r) => `${r.productName}: needed ${r.totalNeededQuantity} - stock ${r.inventoryStockQuantity} = ${r.actuallyNeededQuantity} ${r.normalizedUnit}`)
    .join("; ")}.`;
  const recipeInfo = { recipeId: recipe.id, recipeName: recipe.name, requestedServings, scaleFactor };
  const initialSteps = [
    {
      action: "agent.recipe_loaded",
      summary: `Loaded recipe '${recipe.name}' (${recipe.id}, ${recipe.source}) for ${requestedServings} servings (${scaleFactor}x the base ${recipe.baseServings}).`,
      details: stepDetails("recipe_order", "read_recipe", { ...recipeInfo, ingredients: recipe.ingredients }),
    },
    {
      action: "agent.total_quantity_calculated",
      summary: totalSummary,
      details: stepDetails("recipe_order", "total_quantity", {
        ...recipeInfo,
        totals: ingredientReconciliation.map((r) => ({
          productName: r.productName,
          unit: r.normalizedUnit,
          baseQuantity: r.aggregatedBaseQuantity,
          totalNeededQuantity: r.totalNeededQuantity,
        })),
      }),
    },
    {
      action: "agent.inventory_reconciled",
      summary: `Checked ${ingredientReconciliation.length} ingredient(s) against kitchen stock: ${extractedItems.length} to order, ${coveredCount} covered by stock.`,
      details: stepDetails("recipe_order", "subtract_inventory", { ingredientReconciliation }),
    },
  ];
  const initialStorySteps = [
    makeStep("recipe_order", "read_recipe", {
      status: recipe.ingredients.length ? "done" : "warning",
      summary: readSummary,
      details: { ...recipeInfo, ingredients: recipe.ingredients },
    }),
    makeStep("recipe_order", "total_quantity", {
      status: "done",
      summary: totalSummary,
      details: {
        ...recipeInfo,
        totals: ingredientReconciliation.map((r) => ({
          productName: r.productName,
          productType: r.productType,
          unit: r.normalizedUnit,
          baseQuantity: r.aggregatedBaseQuantity,
          totalNeededQuantity: r.totalNeededQuantity,
        })),
      },
    }),
    makeStep("recipe_order", "subtract_inventory", {
      status: "done",
      summary: inventorySummary,
      details: { ingredientReconciliation, toOrder: extractedItems },
    }),
  ];
  const base = { recipeUsed: recipe, requestedServings, scaleFactor, inventoryUsed, ingredientReconciliation };

  if (ingredientReconciliation.length > 0 && extractedItems.length === 0) {
    return {
      ...base,
      proposal: null,
      selection: { prompt: null, extractedItems: [], pipeline: [], suggestedAlternatives: [], previousOrdersUsed: [], warnings: [], steps: initialStorySteps },
      message: `All ${ingredientReconciliation.length} ingredient(s) for '${recipe.name}' (${requestedServings} servings) are already in stock; nothing to order.`,
    };
  }

  const result = await createProposalFromItems(actorFor(actor, viaAgent), {
    prompt: `Recipe order: ${recipe.name} (${requestedServings} servings)`,
    extractedItems,
    deliveryDate,
    autoResolvePartialStock: input.autoResolvePartialStock,
    source: "recipe",
    initialSteps,
    initialStorySteps,
  });
  return { ...base, proposal: result.proposal, selection: result.selection, message: result.message };
}
