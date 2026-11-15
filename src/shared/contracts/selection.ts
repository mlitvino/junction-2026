import { z } from "zod";

import { NutritionProfileSchema, StockStatusSchema } from "./catalog";
import { ExtractedProductItemSchema } from "./extract";

// How the purchasing agent chooses products for a request (services/selection.ts): the candidates
// it considered, why some were excluded, how it ranked them, and the organization's dietary rules
// it filtered by. Stored on proposals as `selection` (shared/contracts/purchasing.ts).


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
  unitPriceInclVatEur: z.number().optional().meta({ example: 6.16 }),
  vatRatePct: z.number().nullable().optional().meta({ example: 14 }),
  availableQuantity: z.number().nullable().optional().meta({ example: 500 }),
  stockStatus: StockStatusSchema.optional(),
  earliestAvailableDate: z.string().nullable().optional().meta({ example: "2026-11-16" }),
  deliveryReliability: z.number().min(0).max(1).nullable().optional().meta({ example: 0.98 }),
  co2PerKg: z.number().nullable().optional().meta({ example: 4.8 }),
  dietaryTags: z.array(z.string()).meta({ example: ["vegetarian", "gluten-free", "lactose-free"] }),
  sustainabilityCertificates: z
    .array(z.string())
    .optional()
    .meta({
      description: "Sustainability labels and certificates associated with the product.",
      example: ["Hyvää Suomesta (Produced in Finland)", "Heart Symbol"],
    }),
  allergens: z.array(z.string()).meta({ example: ["milk"] }),
  nutrition: NutritionProfileSchema.nullable().meta({ description: "Per 100 g. Null when the catalog has no nutrition data for the product." }),
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
  rankScore: z.number().optional().meta({ description: "0–1 ranking score (see POST /api/products/rank)." }),
  rankReasons: z.array(z.string()).optional(),
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
  parsedUnit: z.string().meta({ example: "L" }),
  orderedQuantity: z.number().nullable().optional().meta({
    description: "The requested amount in the chosen product's sales units (e.g. 1000 L → 200 cases).",
  }),
  conversionNote: z.string().nullable().optional().meta({ example: "1000 L → 200 KI (5 L each)" }),
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
      "Compliant candidates, best first: price per litre/kg, availability by the date, relevance and history, reliability, CO2, preferences (`rankScore`, `rankReasons`). Undeliverable ones last.",
  }),
  selectedProduct: CandidateProductSchema.nullable().meta({
    description: "Top-ranked candidate chosen for the order line, or null if no candidate matched.",
  }),
});

export type ItemProcurementTrace = z.infer<typeof ItemProcurementTraceSchema>;

/**
 * One step of the agent's story, in the order of the user stories:
 *  - `simple_buy` (1 extract, 2 search by type, 3 sort by name, 4 filter by preferences, 5 sort by
 *    history, 6 compare with budget, 7 create the order, 8 approval or change, 9 checkout + receipt)
 *  - `recipe_order` (1 read the recipe, 2 total quantity, 3 minus inventory stock, then 4-11 are the
 *    simple steps 2-9 in the same order)
 * `step` is the number within its story. Steps 2-5 repeat for every requested item (`item`).
 */
export const StoryStepSchema = z.object({
  story: z.enum(["simple_buy", "recipe_order"]),
  step: z.number().int().min(1).meta({ description: "Step number within the story.", example: 4 }),
  key: z.enum([
    "extract",
    "read_recipe",
    "total_quantity",
    "subtract_inventory",
    "search_by_type",
    "sort_by_name",
    "filter_preferences",
    "sort_by_history",
    "compare_budget",
    "create_order",
    "approval_or_change",
    "checkout_receipt",
  ]),
  title: z.string().meta({ example: "Remove products that break the preferences" }),
  item: z.string().nullable().meta({
    description: "The requested product name the step is about; null when it covers the whole order.",
  }),
  status: z.enum(["done", "warning", "blocked", "pending", "skipped"]).meta({
    description:
      "`done`; `warning`: done but a human should look; `blocked`: the policy stops the order; `skipped`: nothing to do (e.g. no order history); " +
      "`pending`: a later human step (8 and 9), where the live state is the proposal's own `status`, `approval` and `orderId`.",
  }),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type StoryStep = z.infer<typeof StoryStepSchema>;

/** Suggested alternative candidate for swapping a line item in Step 8 */
export const SuggestedAlternativeSchema = z.object({
  forProductId: z.string().meta({ example: "460101" }),
  forProductName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  alternatives: z.array(CandidateProductSchema).meta({
    description:
      "Preference-compliant alternative products that can replace this line via PATCH /api/orders/{orderId}.",
  }),
});

export type SuggestedAlternative = z.infer<typeof SuggestedAlternativeSchema>;

/** Add line instruction on an existing order */
export const OrderAddItemSchema = z.object({
  productId: z.string().trim().min(1).meta({ example: "460202" }),
  quantity: z.number().positive().meta({ example: 50 }),
});

export type OrderAddItem = z.infer<typeof OrderAddItemSchema>;

