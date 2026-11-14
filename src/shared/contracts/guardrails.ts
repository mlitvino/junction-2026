import { z } from "zod";

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

/** Agent purchasing authority and permission rules (guardrails) */
export const AgentGuardrailsSchema = z.object({
  budgetEur: z.number().positive().meta({
    description: "Maximum target budget per order in EUR (excl. VAT).",
    example: 2500,
  }),
  autoApproveLimitEur: z.number().nonnegative().meta({
    description:
      "Maximum order total in EUR (excl. VAT) that the agent/buyer may confirm autonomously without human approval.",
    example: 2500,
  }),
  maxUnitPriceEur: z.number().positive().optional().meta({
    description: "Optional cap on unit price (EUR) before human sign-off is required.",
    example: 50,
  }),
  maxSingleLineQuantity: z.number().positive().optional().meta({
    description: "Optional cap on a single line item's quantity before human sign-off is required.",
    example: 1000,
  }),
  allowedCategories: z.array(z.string()).meta({
    description:
      "Categories permitted for autonomous ordering (empty array allows all non-blocked categories).",
    example: [],
  }),
  blockedCategories: z.array(z.string()).meta({
    description: "Categories restricted from autonomous ordering without human approval.",
    example: ["ALCOHOL", "TOBACCO"],
  }),
  allowedProductIds: z.array(z.string()).meta({
    description:
      "Specific product IDs permitted for autonomous ordering (empty array allows all non-blocked products).",
    example: [],
  }),
  blockedProductIds: z.array(z.string()).meta({
    description: "Specific product IDs restricted from autonomous ordering without human approval.",
    example: [],
  }),
  requireApprovalOnStockShortfall: z.boolean().meta({
    description:
      "If true, orders containing out-of-stock or partial-stock items pause in pending_approval for human review.",
    example: true,
  }),
  requireCustomerConfirmation: z.boolean().meta({
    description:
      "If true, every order pauses in pending_approval so a human can review or swap products before checkout.",
    example: false,
  }),
});

export type AgentGuardrails = z.infer<typeof AgentGuardrailsSchema>;

/** Partial guardrail override accepted in order requests and settings updates */
export const PartialAgentGuardrailsSchema = AgentGuardrailsSchema.partial();

export type PartialAgentGuardrails = z.infer<typeof PartialAgentGuardrailsSchema>;

/** Individual guardrail rule violation detected during order validation */
export const GuardrailViolationSchema = z.object({
  rule: z
    .enum([
      "budget_exceeded",
      "auto_approve_limit_exceeded",
      "max_unit_price_exceeded",
      "max_line_quantity_exceeded",
      "category_not_allowed",
      "category_blocked",
      "product_not_allowed",
      "product_blocked",
      "stock_shortfall",
      "customer_confirmation_required",
    ])
    .meta({ description: "Identifier of the triggered guardrail rule." }),
  severity: z.enum(["approval_required", "warning"]).meta({
    description: "Whether the violation forces human sign-off before checkout.",
    example: "approval_required",
  }),
  productId: z.string().nullable().meta({
    description: "Product ID that triggered the rule, or null for order-level rules.",
    example: "460101",
  }),
  message: z.string().meta({
    description: "Human-readable explanation of why the guardrail triggered.",
    example: "Order total (2850 EUR) exceeds autonomous spending limit (2500 EUR).",
  }),
});

export type GuardrailViolation = z.infer<typeof GuardrailViolationSchema>;

/** Overall result of evaluating an order against agent permission guardrails */
export const GuardrailEvaluationSchema = z.object({
  authorizedForAutoConfirm: z.boolean().meta({
    description:
      "True when the agent has full permission to confirm the order without human sign-off.",
    example: true,
  }),
  requiresHumanApproval: z.boolean().meta({
    description: "True when an approver must review and sign off before checkout.",
    example: false,
  }),
  violations: z.array(GuardrailViolationSchema).meta({
    description: "List of triggered permission/guardrail checks.",
  }),
});

export type GuardrailEvaluation = z.infer<typeof GuardrailEvaluationSchema>;

/** GET /api/guardrails — active customer preferences & agent permission settings */
export const ProcurementSettingsSchema = z.object({
  organizationId: z.string().nullable().meta({
    description:
      "Organization ID owning these settings, or null for default/unauthenticated scope.",
  }),
  preferences: CustomerPreferencesSchema,
  guardrails: AgentGuardrailsSchema,
  updatedAt: z.iso.datetime(),
});

export type ProcurementSettings = z.infer<typeof ProcurementSettingsSchema>;

/** PUT /api/guardrails — request body */
export const UpdateProcurementSettingsRequestSchema = z.object({
  preferences: CustomerPreferencesSchema.optional().meta({
    description: "Updated dietary, allergen, and nutritional preferences.",
  }),
  guardrails: PartialAgentGuardrailsSchema.optional().meta({
    description: "Updated agent spending limits and product/category permission rules.",
  }),
});

export type UpdateProcurementSettingsRequest = z.infer<
  typeof UpdateProcurementSettingsRequestSchema
>;
