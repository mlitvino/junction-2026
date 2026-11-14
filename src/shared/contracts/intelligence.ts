import { z } from "zod";

import { CatalogProductSummarySchema } from "./catalog";
import { CandidateProductSchema, CustomerPreferencesSchema, OrderAddItemSchema, RemovedCandidateSchema } from "./selection";

/** Optional Feature #2: Delivery lead-time and reliability comparison against requested deadline */
export const DeliveryComparisonSchema = z.object({
  requestedDeliveryDate: z.iso.date().meta({ example: "2026-11-16" }),
  earliestAvailableDate: z.string().nullable().meta({ example: "2026-11-16" }),
  estimatedLeadTimeDays: z.number().int().nonnegative().meta({ example: 1 }),
  meetsDeadline: z.boolean().meta({
    description: "True when earliestAvailableDate is on or before requestedDeliveryDate.",
    example: true,
  }),
  daysDeltaFromDeadline: z.number().int().meta({
    description:
      "Days relative to requestedDeliveryDate (<= 0 means on-time/early, > 0 means late).",
    example: 0,
  }),
  deliveryReliability: z.number().min(0).max(1).nullable().meta({ example: 0.99 }),
  reliabilityTier: z.enum(["high", "medium", "low", "unknown"]).meta({
    description: "'high' >= 0.97, 'medium' >= 0.93, 'low' < 0.93.",
    example: "high",
  }),
  summary: z.string().meta({
    example: "On-time for 2026-11-16 (1-day lead time, 99.0% historical reliability).",
  }),
});

export type DeliveryComparison = z.infer<typeof DeliveryComparisonSchema>;

/** Optional Features #3 & #7: Sustainability certificates and category-level CO2 comparison */
export const SustainabilityComparisonSchema = z.object({
  category: z.string().meta({ example: "CHEESE" }),
  certificates: z.array(z.string()).meta({
    description: "Sustainability, origin, and climate labels on the product.",
    example: ["Hyvää Suomesta (Produced in Finland)", "Carbo® Climate-Reduced Milk"],
  }),
  countryOfOrigin: z.string().nullable().meta({ example: "fi" }),
  productCo2PerKg: z.number().nullable().meta({ example: 4.7 }),
  categoryMinCo2PerKg: z.number().nullable().meta({ example: 4.7 }),
  categoryAvgCo2PerKg: z.number().nullable().meta({ example: 5.25 }),
  categoryMaxCo2PerKg: z.number().nullable().meta({ example: 6.1 }),
  co2VsCategoryAvgPct: z.number().nullable().meta({
    description:
      "Percentage difference vs category average CO2/kg (negative means lower footprint than category average).",
    example: -10.48,
  }),
  footprintRating: z.enum(["low_impact", "average_impact", "high_impact", "unknown"]).meta({
    example: "low_impact",
  }),
  summary: z.string().meta({
    example:
      "4.70 kg CO2e/kg (-10.5% vs CHEESE avg 5.25; range 4.70–6.10); 2 sustainability label(s).",
  }),
});

export type SustainabilityComparison = z.infer<typeof SustainabilityComparisonSchema>;

/** Optional Features #5 & #8: Allergen-safe Good / Better / Best substitute recommendation */
export const RankedSubstituteSchema = z.object({
  tier: z.enum(["best", "better", "good"]).meta({
    description: "Good / Better / Best assortment recommendation tier.",
    example: "best",
  }),
  rank: z.number().int().positive().meta({ example: 1 }),
  overallScore: z.number().min(0).max(1).meta({ example: 0.91 }),
  allergenAndPreferenceSafe: z.literal(true).meta({
    description:
      "Guaranteed compliant with all active dietary restrictions, excluded allergens, and nutrition limits.",
  }),
  candidate: CandidateProductSchema,
  priceDeltaEur: z.number().meta({
    description: "Unit price difference vs target product (negative = cheaper).",
    example: 0.4,
  }),
  co2DeltaPerKg: z.number().nullable().meta({
    description: "CO2/kg difference vs target product (negative = lower carbon footprint).",
    example: -0.2,
  }),
  reliabilityDelta: z.number().nullable().meta({
    description: "Delivery reliability difference vs target product (positive = more reliable).",
    example: -0.01,
  }),
  deliveryComparison: DeliveryComparisonSchema,
  sustainabilityComparison: SustainabilityComparisonSchema,
  tradeOffs: z.array(z.string()).meta({
    description: "Human-readable explanation of price, stock, sustainability, and delivery trade-offs.",
    example: [
      "+0.40 EUR/KG (+7.4%) vs primary product",
      "Lower carbon footprint (-0.20 kg CO2e/kg)",
      "500 KG immediately available in stock",
    ],
  }),
});

export type RankedSubstitute = z.infer<typeof RankedSubstituteSchema>;

/** Single line allocation in a partial-availability fulfillment plan */
export const SplitAllocationLineSchema = z.object({
  role: z.enum(["primary", "substitute"]),
  productId: z.string().meta({ example: "460101" }),
  productName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  allocatedQuantity: z.number().positive().meta({ example: 650 }),
  availableQuantity: z.number().nullable().meta({ example: 650 }),
  unit: z.string().meta({ example: "KG" }),
  unitPriceEur: z.number().meta({ example: 5.4 }),
  lineTotalEur: z.number().meta({ example: 3510 }),
});

export type SplitAllocationLine = z.infer<typeof SplitAllocationLineSchema>;

/** Optional Feature #4: Partial availability handling & multi-SKU split proposal */
export const PartialAvailabilityPlanSchema = z.object({
  requestedQuantity: z.number().positive().meta({ example: 800 }),
  primaryAvailableQuantity: z.number().nonnegative().nullable().meta({ example: 650 }),
  shortfallOnPrimary: z.number().nonnegative().meta({ example: 150 }),
  requiresSplitOrSubstitute: z.boolean().meta({ example: true }),
  fullyFulfillableWithSubstitutes: z.boolean().meta({ example: true }),
  totalFulfilledQuantity: z.number().nonnegative().meta({ example: 800 }),
  remainingUnfulfilledQuantity: z.number().nonnegative().meta({ example: 0 }),
  totalPlanCostEur: z.number().nonnegative().meta({ example: 4380 }),
  allocations: z.array(SplitAllocationLineSchema),
  summary: z.string().meta({
    example:
      "Primary SKU 460101 covers 650 KG; remaining 150 KG fulfilled via allergen-safe substitute 460102 (total 800 KG, 4380.00 EUR).",
  }),
});

export type PartialAvailabilityPlan = z.infer<typeof PartialAvailabilityPlanSchema>;

/** POST /api/products/{id}/substitutes — request body (productId comes from the path) */
export const ProductSubstitutionRequestSchema = z.object({
  productId: z.string().trim().min(1).meta({
    description: "Target Valio product ID that needs comparison, substitution, or shortfall coverage.",
    example: "460101",
  }),
  requestedQuantity: z.number().positive().default(100).meta({
    description: "Desired quantity to evaluate stock sufficiency and split allocations.",
    example: 800,
  }),
  deliveryDate: z.iso.date().optional().meta({ example: "2026-11-16" }),
});

export type ProductSubstitutionRequest = z.infer<typeof ProductSubstitutionRequestSchema>;

/** POST /api/products/{id}/substitutes — response body */
export const ProductSubstitutionResponseSchema = z.object({
  targetProduct: CandidateProductSchema,
  targetDeliveryComparison: DeliveryComparisonSchema,
  targetSustainabilityComparison: SustainabilityComparisonSchema,
  preferencesEnforced: CustomerPreferencesSchema,
  excludedUnsafeAlternatives: z.array(RemovedCandidateSchema).meta({
    description:
      "Candidate substitutes rejected because they violate allergen, dietary, or nutrition safety constraints.",
  }),
  rankedSubstitutes: z.array(RankedSubstituteSchema).meta({
    description: "Allergen-safe Good / Better / Best alternatives with trade-off analysis.",
  }),
  partialAvailabilityPlan: PartialAvailabilityPlanSchema,
});

export type ProductSubstitutionResponse = z.infer<typeof ProductSubstitutionResponseSchema>;

/** Optional Feature #10: Proactive supplier-stock-out & kitchen low-stock alert */
export const ProactiveStockoutAlertSchema = z.object({
  alertId: z.string().meta({ example: "ALT-STOCK-460502" }),
  triggerType: z.enum(["supplier_out_of_stock", "kitchen_below_par_level"]).meta({
    example: "supplier_out_of_stock",
  }),
  severity: z.enum(["critical", "warning"]).meta({ example: "critical" }),
  affectedProductId: z.string().nullable().meta({ example: "460502" }),
  affectedName: z.string().meta({ example: "Valio Heavy Whipping Cream 38% 1L" }),
  productType: z.string().meta({ example: "Cream" }),
  impactedRecipes: z.array(z.string()).meta({
    description: "Customer/Valio recipes impacted by this shortage.",
    example: ["Traditional Finnish Creamy Salmon Soup (Lohikeitto)"],
  }),
  shortageSummary: z.string().meta({
    example:
      "Supplier SKU 460502 has 0 L available on 2026-11-16; impacts 1 dish recipe.",
  }),
  recommendedReplacements: z.array(RankedSubstituteSchema).meta({
    description: "Allergen-safe, recipe-compatible replacement products ready to order.",
  }),
});

export type ProactiveStockoutAlert = z.infer<typeof ProactiveStockoutAlertSchema>;

/** GET /api/intelligence/stockout-alerts — response body */
export const StockoutAlertsResponseSchema = z.object({
  checkedAt: z.iso.datetime(),
  deliveryDate: z.iso.date(),
  alerts: z.array(ProactiveStockoutAlertSchema),
});

export type StockoutAlertsResponse = z.infer<typeof StockoutAlertsResponseSchema>;

/** Optional Feature #11: Detected anomaly when repeating or comparing a recurring order */
export const RecurringOrderAnomalySchema = z.object({
  anomalyType: z.enum([
    "quantity_spike",
    "quantity_drop",
    "unit_price_surge",
    "total_spend_spike",
    "unusual_new_product",
  ]),
  severity: z.enum(["high", "medium"]),
  productId: z.string().nullable(),
  productName: z.string().nullable(),
  historicalBaseline: z.number().nullable().meta({ example: 120 }),
  proposedValue: z.number().meta({ example: 480 }),
  deviationRatio: z.number().nullable().meta({
    description: "Ratio of proposedValue to historicalBaseline (e.g. 4.0 = 4x usual order).",
    example: 4,
  }),
  explanation: z.string().meta({
    example:
      "Proposed quantity for 'Valio Oltermanni Creamy Cheese 1kg' (480 KG) is 4.00x the historical average (120.0 KG).",
  }),
});

export type RecurringOrderAnomaly = z.infer<typeof RecurringOrderAnomalySchema>;

/** POST /api/intelligence/recurring-check — request body */
export const RecurringOrderCheckRequestSchema = z.object({
  proposalId: z.string().trim().min(1).optional().meta({
    description: "A proposal to inspect before it is ordered.",
  }),
  items: z.array(OrderAddItemSchema).min(1).max(100).optional().meta({
    description: "Proposed recurring order items when checking before creating an order.",
  }),
  deliveryDate: z.iso.date().optional(),
});

export type RecurringOrderCheckRequest = z.infer<typeof RecurringOrderCheckRequestSchema>;

/** POST /api/intelligence/recurring-check — response body */
export const RecurringOrderCheckResponseSchema = z.object({
  safeToAutoRepeat: z.boolean().meta({
    description: "True when no high/medium anomalies were detected against order history.",
    example: false,
  }),
  historicalOrderCount: z.number().int().nonnegative(),
  proposedTotalEur: z.number().nonnegative(),
  historicalAverageItemQuantity: z.number().nullable(),
  anomalies: z.array(RecurringOrderAnomalySchema),
  summary: z.string(),
});

export type RecurringOrderCheckResponse = z.infer<typeof RecurringOrderCheckResponseSchema>;

/** Optional Feature #12: Proactive supplier-side product recommendation */
export const ProactiveRecommendationSchema = z.object({
  product: CatalogProductSummarySchema,
  unitPriceEur: z.number().meta({ example: 4.9 }),
  availableQuantity: z.number().nullable().meta({ example: 220 }),
  recommendationType: z.enum([
    "seasonal_highlight",
    "new_arrival",
    "lower_carbon_switch",
    "recipe_inventory_gap",
  ]),
  headline: z.string().meta({
    example: "Seasonal Nordic Berry Highlight for Canteen Menus",
  }),
  rationale: z.string().meta({
    example:
      "Newly available Finnish seasonal cloudberry quark; matches your vegetarian & gluten-free kitchen profile.",
  }),
  sustainabilityComparison: SustainabilityComparisonSchema,
});

export type ProactiveRecommendation = z.infer<typeof ProactiveRecommendationSchema>;

/** GET /api/intelligence/recommendations — response body */
export const ProactiveRecommendationsResponseSchema = z.object({
  generatedAt: z.iso.datetime(),
  preferencesApplied: CustomerPreferencesSchema,
  recommendations: z.array(ProactiveRecommendationSchema),
});

export type ProactiveRecommendationsResponse = z.infer<
  typeof ProactiveRecommendationsResponseSchema
>;
