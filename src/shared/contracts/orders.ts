import { z } from "zod";

import { ExtractedProductItemSchema } from "./extract";

/** Nutritional profile per 100g */
export const NutritionProfileSchema = z.object({
  caloriesPer100g: z.number().meta({ description: "Energy in kcal per 100g.", example: 340 }),
  fatPer100g: z.number().meta({ description: "Fat in grams per 100g.", example: 28 }),
  sugarPer100g: z.number().meta({ description: "Sugars in grams per 100g.", example: 0.5 }),
  saltPer100g: z.number().meta({ description: "Salt in grams per 100g.", example: 1.4 }),
  proteinPer100g: z.number().meta({ description: "Protein in grams per 100g.", example: 23 }),
});

export type NutritionProfile = z.infer<typeof NutritionProfileSchema>;

/** Customer nutritional constraints (per 100g) */
export const NutritionPreferencesSchema = z.object({
  maxCaloriesPer100g: z.number().optional().meta({
    description: "Maximum allowed kcal per 100g.",
    example: 450,
  }),
  maxFatPer100g: z.number().optional().meta({
    description: "Maximum allowed fat (g) per 100g.",
    example: 38,
  }),
  maxSugarPer100g: z.number().optional().meta({
    description: "Maximum allowed sugar (g) per 100g.",
    example: 15,
  }),
  maxSaltPer100g: z.number().optional().meta({
    description: "Maximum allowed salt (g) per 100g.",
    example: 2.5,
  }),
  minProteinPer100g: z.number().optional().meta({
    description: "Minimum required protein (g) per 100g.",
    example: 5,
  }),
});

export type NutritionPreferences = z.infer<typeof NutritionPreferencesSchema>;

/** Customer dietary, allergen, and nutritional preferences */
export const CustomerPreferencesSchema = z.object({
  dietaryRestrictions: z.array(z.string()).meta({
    description:
      "Required dietary classifications (e.g., 'vegetarian', 'lactose-free', 'gluten-free').",
    example: ["vegetarian", "gluten-free"],
  }),
  excludedAllergens: z.array(z.string()).meta({
    description: "Allergens that must not be present in selected products.",
    example: ["peanuts", "tree-nuts", "soy", "crustaceans"],
  }),
  nutrition: NutritionPreferencesSchema.meta({
    description: "Nutritional thresholds per 100g.",
  }),
});

export type CustomerPreferences = z.infer<typeof CustomerPreferencesSchema>;

/** Historical order entry used for sorting by previously ordered product and brand */
export const PreviousOrderRecordSchema = z.object({
  orderId: z.string().meta({ example: "ORD-HIST-001" }),
  orderedAt: z.string().meta({ example: "2026-10-25T09:30:00.000Z" }),
  productId: z.string().meta({ example: "460101" }),
  productName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  brand: z.string().meta({ example: "Valio" }),
  quantity: z.number().meta({ example: 100 }),
});

export type PreviousOrderRecord = z.infer<typeof PreviousOrderRecordSchema>;

/** Candidate product evaluated during the ordering pipeline */
export const CandidateProductSchema = z.object({
  id: z.string().meta({ example: "460101" }),
  name: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  productType: z.string().meta({ example: "Cheese" }),
  category: z.string().meta({ example: "CHEESE" }),
  brand: z.string().nullable().meta({ example: "Valio" }),
  vendorName: z.string().meta({ example: "Valio Oy" }),
  salesUnit: z.string().meta({ example: "KG" }),
  unitPriceEur: z.number().meta({ example: 5.4 }),
  dietaryTags: z.array(z.string()).meta({ example: ["vegetarian", "gluten-free", "lactose-free"] }),
  allergens: z.array(z.string()).meta({ example: ["milk"] }),
  nutrition: NutritionProfileSchema,
  nameMatchScore: z.number().min(0).max(1).meta({
    description: "Similarity score (0–1) against the extracted product name.",
    example: 0.85,
  }),
  previouslyOrderedProduct: z.boolean().meta({
    description: "True if this specific product appears in the customer's previous orders.",
  }),
  previouslyOrderedBrand: z.boolean().meta({
    description: "True if this product's brand appears in the customer's previous orders.",
  }),
});

export type CandidateProduct = z.infer<typeof CandidateProductSchema>;

/** Product removed due to failing customer preference checks */
export const RemovedCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  reasons: z.array(z.string()).meta({
    description:
      "Reasons why the product was filtered out (dietary restriction, allergen, or nutrition).",
    example: ["Contains excluded allergen: soy"],
  }),
});

export type RemovedCandidate = z.infer<typeof RemovedCandidateSchema>;

/** Per-item procurement pipeline trace */
export const ItemProcurementTraceSchema = z.object({
  extractedItem: ExtractedProductItemSchema,
  parsedQuantity: z.number().meta({ example: 420 }),
  parsedUnit: z.string().meta({ example: "kg" }),
  matchedByTypeCount: z.number().int().meta({
    description:
      "Total products found matching the extracted productType before preference filtering.",
    example: 5,
  }),
  removedByPreferences: z.array(RemovedCandidateSchema).meta({
    description:
      "Products removed due to dietary restrictions, allergens, or nutrition mismatches.",
  }),
  sortedCandidates: z.array(CandidateProductSchema).meta({
    description:
      "Remaining candidates sorted by previous order history (product, then brand) and best match by productName.",
  }),
  selectedProduct: CandidateProductSchema.nullable().meta({
    description: "Top-ranked candidate chosen for the order line, or null if no candidate matched.",
  }),
});

export type ItemProcurementTrace = z.infer<typeof ItemProcurementTraceSchema>;

/** Order line item */
export const OrderLineItemSchema = z.object({
  productId: z.string().meta({ example: "460101" }),
  productName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  brand: z.string().nullable().meta({ example: "Valio" }),
  productType: z.string().meta({ example: "Cheese" }),
  requestedProductName: z.string().meta({ example: "Creamy cheese" }),
  quantity: z.number().meta({ example: 420 }),
  unit: z.string().meta({ example: "KG" }),
  unitPriceEur: z.number().meta({ example: 5.4 }),
  lineTotalEur: z.number().meta({ example: 2268 }),
  nameMatchScore: z.number().meta({ example: 0.85 }),
  previouslyOrderedProduct: z.boolean(),
  previouslyOrderedBrand: z.boolean(),
});

export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

/** Comparison of order total against customer budget */
export const BudgetComparisonSchema = z.object({
  budgetEur: z.number().meta({ description: "Customer budget limit in EUR.", example: 2500 }),
  totalPriceEur: z.number().meta({ description: "Total order cost in EUR.", example: 2268 }),
  currency: z.literal("EUR"),
  withinBudget: z.boolean().meta({
    description: "True when totalPriceEur is less than or equal to budgetEur.",
    example: true,
  }),
  remainingBudgetEur: z.number().meta({
    description: "Remaining budget (budgetEur - totalPriceEur); negative if over budget.",
    example: 232,
  }),
  exceededByEur: z.number().meta({
    description: "Amount by which totalPriceEur exceeds budgetEur (0 when within budget).",
    example: 0,
  }),
});

export type BudgetComparison = z.infer<typeof BudgetComparisonSchema>;

/** Created order object */
export const CreatedOrderSchema = z.object({
  orderId: z.string().meta({ example: "ORD-20261114-001" }),
  status: z.enum(["confirmed", "pending_approval", "unfulfilled"]).meta({
    description:
      "'confirmed' when within budget, 'pending_approval' when total exceeds customer budget, 'unfulfilled' when no matching products remain.",
    example: "confirmed",
  }),
  createdAt: z.iso.datetime(),
  lines: z.array(OrderLineItemSchema),
  totalPriceEur: z.number().meta({ example: 2268 }),
  currency: z.literal("EUR"),
  budgetComparison: BudgetComparisonSchema,
});

export type CreatedOrder = z.infer<typeof CreatedOrderSchema>;

/** POST /api/orders — request body */
export const CreateOrderFromPromptRequestSchema = z.object({
  prompt: z.string().trim().min(1).meta({
    description: "Free-form natural-language purchasing request from the user.",
    example: "I want to buy 420 kg of creamy cheese",
  }),
  preferences: CustomerPreferencesSchema.optional().meta({
    description: "Optional customer preferences override (defaults to mock customer preferences).",
  }),
  budgetEur: z.number().positive().optional().meta({
    description:
      "Optional customer budget in EUR override (defaults to mock customer budget of 2500 EUR).",
    example: 2500,
  }),
  previousOrders: z.array(PreviousOrderRecordSchema).optional().meta({
    description: "Optional previous orders override (defaults to mock historical order data).",
  }),
});

export type CreateOrderFromPromptRequest = z.infer<typeof CreateOrderFromPromptRequestSchema>;

/** POST /api/orders — response body */
export const CreateOrderFromPromptResponseSchema = z.object({
  prompt: z.string(),
  extractedItems: z.array(ExtractedProductItemSchema),
  preferencesUsed: CustomerPreferencesSchema,
  previousOrdersUsed: z.array(PreviousOrderRecordSchema),
  pipeline: z.array(ItemProcurementTraceSchema),
  order: CreatedOrderSchema,
});

export type CreateOrderFromPromptResponse = z.infer<typeof CreateOrderFromPromptResponseSchema>;
