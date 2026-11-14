import { z } from "zod";

import { ExtractedProductItemSchema } from "./extract";
import { CustomerPreferencesSchema, PartialAgentGuardrailsSchema } from "./guardrails";
import { InventoryItemSchema, UpsertInventoryItemRequestSchema } from "./inventory";
import {
  CreatedOrderSchema,
  ItemProcurementTraceSchema,
  PreviousOrderRecordSchema,
  SuggestedAlternativeSchema,
} from "./orders";

/** Origin of a recipe in the system */
export const RecipeSourceSchema = z.enum(["valio_recipe_book", "customer"]).meta({
  description:
    "'valio_recipe_book' for trusted built-in Valio recipes; 'customer' for custom kitchen recipes.",
  example: "valio_recipe_book",
});

export type RecipeSource = z.infer<typeof RecipeSourceSchema>;

/** Ingredient entry in a dish recipe ([Product name] - [Product type] - [Quantity]) */
export const RecipeIngredientSchema = z.object({
  productName: z.string().trim().min(1).meta({
    description: "Ingredient / product name in the recipe.",
    example: "Salmon fillet",
  }),
  productType: z.string().trim().min(1).meta({
    description: "General product category or type used for catalog search.",
    example: "Fish",
  }),
  quantity: z.number().positive().meta({
    description: "Required amount for `baseServings` of the recipe.",
    example: 1.8,
  }),
  unit: z.string().trim().min(1).meta({
    description: "Measurement unit (e.g. 'KG', 'G', 'L', 'ML').",
    example: "KG",
  }),
  notes: z.string().optional().meta({
    description: "Optional culinary preparation note.",
    example: "Skinless cubed fillet",
  }),
});

export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

/** Stored recipe definition */
export const RecipeSchema = z.object({
  id: z.string().meta({ example: "recipe-salmon-soup" }),
  organizationId: z.string().nullable().meta({ example: null }),
  name: z.string().meta({
    example: "Traditional Finnish Creamy Salmon Soup (Lohikeitto)",
  }),
  source: RecipeSourceSchema,
  description: z.string().nullable().meta({
    example:
      "Classic Nordic creamy salmon soup with diced Finnish potatoes, leek, carrots, butter, cooking cream, and fresh dill.",
  }),
  baseServings: z.number().positive().meta({
    description: "Number of servings produced by the base ingredient quantities.",
    example: 10,
  }),
  ingredients: z.array(RecipeIngredientSchema),
  instructions: z.string().nullable(),
  tags: z.array(z.string()).meta({
    example: ["salmon-soup", "soup", "nordic", "lunch"],
  }),
  updatedAt: z.iso.datetime(),
});

export type Recipe = z.infer<typeof RecipeSchema>;

/** GET /api/recipes — query parameters */
export const RecipeListQuerySchema = z.object({
  q: z.string().trim().max(160).optional().meta({
    description: "Optional search query matching recipe name, description, tags, or ingredients.",
    example: "salmon soup",
  }),
  tag: z.string().trim().max(60).optional().meta({
    description: "Optional tag filter (e.g. 'soup', 'lunch').",
    example: "soup",
  }),
});

export type RecipeListQuery = z.infer<typeof RecipeListQuerySchema>;

/** GET /api/recipes — response body */
export const RecipeListResponseSchema = z.object({
  recipes: z.array(RecipeSchema),
});

export type RecipeListResponse = z.infer<typeof RecipeListResponseSchema>;

/** POST /api/recipes — create a customer-provided recipe */
export const CreateRecipeRequestSchema = z.object({
  name: z.string().trim().min(1).max(160).meta({
    example: "School Canteen Creamy Vegetable Soup",
  }),
  description: z.string().trim().max(500).optional(),
  baseServings: z.number().positive().default(10).meta({ example: 10 }),
  ingredients: z.array(RecipeIngredientSchema).min(1).max(50),
  instructions: z.string().trim().max(4000).optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
});

export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequestSchema>;

/** Inline customer recipe accepted directly on POST /api/orders/from-recipe */
export const InlineCustomRecipeSchema = z.object({
  name: z.string().trim().min(1).max(160).meta({ example: "Chef's Salmon Chowder" }),
  baseServings: z.number().positive().default(10).meta({ example: 10 }),
  ingredients: z.array(RecipeIngredientSchema).min(1).max(50),
});

export type InlineCustomRecipe = z.infer<typeof InlineCustomRecipeSchema>;

/**
 * Step 1–3 trace for a recipe ingredient:
 * aggregates total quantity needed and subtracts available customer inventory stock.
 */
export const RecipeIngredientReconciliationSchema = z.object({
  productName: z.string().meta({ example: "Cooking cream" }),
  productType: z.string().meta({ example: "Cream" }),
  normalizedUnit: z.string().meta({
    description: "Normalized procurement unit ('KG' for mass, 'L' for volume).",
    example: "L",
  }),
  aggregatedBaseQuantity: z.number().meta({
    description:
      "Summed base recipe quantity for this ingredient across all matching lines in normalized units.",
    example: 1,
  }),
  totalNeededQuantity: z.number().meta({
    description: "Scaled total quantity required for the requested servings/batches.",
    example: 4,
  }),
  inventoryStockQuantity: z.number().meta({
    description: "Matching on-hand stock found in the customer's kitchen inventory.",
    example: 2.5,
  }),
  actuallyNeededQuantity: z.number().meta({
    description:
      "Net quantity to order from Valio Aimo: max(0, totalNeededQuantity - inventoryStockQuantity).",
    example: 1.5,
  }),
  coveredByInventory: z.boolean().meta({
    description: "True when existing kitchen stock completely covers totalNeededQuantity.",
    example: false,
  }),
  matchedInventoryItemIds: z.array(z.string()).meta({
    description: "IDs of customer inventory items matched against this ingredient.",
    example: ["inv-cooking-cream"],
  }),
});

export type RecipeIngredientReconciliation = z.infer<
  typeof RecipeIngredientReconciliationSchema
>;

/** POST /api/orders/from-recipe — request body */
export const CreateOrderFromRecipeRequestSchema = z.object({
  recipeId: z.string().trim().min(1).optional().meta({
    description: "ID of a saved recipe (e.g. 'recipe-salmon-soup').",
    example: "recipe-salmon-soup",
  }),
  dishQuery: z.string().trim().min(1).optional().meta({
    description:
      "Dish name or natural-language request when recipeId is omitted (e.g. 'salmon soup').",
    example: "salmon soup",
  }),
  customRecipe: InlineCustomRecipeSchema.optional().meta({
    description: "Optional inline customer-provided recipe to order without saving first.",
  }),
  servings: z.number().positive().optional().meta({
    description:
      "Desired number of servings to prepare. Scales recipe quantities by (servings / baseServings).",
    example: 40,
  }),
  batchMultiplier: z.number().positive().optional().meta({
    description: "Optional direct multiplier on base recipe quantities (used if servings is omitted).",
    example: 4,
  }),
  deliveryDate: z.iso.date().optional().meta({
    description: "Desired delivery date (YYYY-MM-DD). Defaults to today's date.",
    example: "2026-11-16",
  }),
  inventoryOverride: z.array(UpsertInventoryItemRequestSchema).optional().meta({
    description:
      "Optional customer inventory snapshot override (defaults to saved organization/mock kitchen stock).",
  }),
  preferences: CustomerPreferencesSchema.optional().meta({
    description: "Optional customer preferences override.",
  }),
  budgetEur: z.number().positive().optional().meta({
    description: "Optional customer budget in EUR override.",
    example: 2500,
  }),
  guardrails: PartialAgentGuardrailsSchema.optional().meta({
    description: "Optional agent permission guardrails override.",
  }),
  previousOrders: z.array(PreviousOrderRecordSchema).optional().meta({
    description: "Optional previous orders override.",
  }),
  requireApproval: z.boolean().optional().meta({
    description: "If true, pauses the created order in pending_approval for human review.",
  }),
  autoResolvePartialStock: z.boolean().optional().meta({
    description:
      "If true, splits insufficient-stock lines across allergen-safe substitutes automatically.",
  }),
});

export type CreateOrderFromRecipeRequest = z.infer<typeof CreateOrderFromRecipeRequestSchema>;

/** POST /api/orders/from-recipe — response body */
export const CreateOrderFromRecipeResponseSchema = z.object({
  recipeUsed: RecipeSchema,
  requestedServings: z.number(),
  scaleFactor: z.number().meta({
    description: "Multiplier applied to base recipe ingredient quantities.",
    example: 4,
  }),
  inventoryUsed: z.array(InventoryItemSchema),
  ingredientReconciliation: z.array(RecipeIngredientReconciliationSchema).meta({
    description:
      "Per-ingredient calculation of total needed minus inventory stock (Steps 1–3).",
  }),
  extractedItems: z.array(ExtractedProductItemSchema).meta({
    description:
      "Net remaining ingredients (actuallyNeeded > 0) sent into the catalog procurement pipeline.",
  }),
  preferencesUsed: CustomerPreferencesSchema,
  previousOrdersUsed: z.array(PreviousOrderRecordSchema),
  pipeline: z.array(ItemProcurementTraceSchema),
  suggestedAlternatives: z.array(SuggestedAlternativeSchema),
  order: CreatedOrderSchema,
});

export type CreateOrderFromRecipeResponse = z.infer<typeof CreateOrderFromRecipeResponseSchema>;
