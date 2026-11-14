import { z } from "zod";

// Preferences of an organization's buyers and approvers: product criteria, vendor/brand rules,
// spending and approval rules, AI behavior. Settings live in three layers per organization:
//   base (everyone, can lock settings) → buyer / approver (per role)
// Effective value for a role = role layer (unless locked) → base → system default.
// In a layer an absent key means "inherit"; null (nullable settings) means "no limit" and
// overrides the layer above. Lists replace, they are not merged.

/** All settings with their value types. Every layer may set any of them. */
export const PreferencesSchema = z.object({
  // ----- Product criteria -----
  maxCo2PerKg: z.number().positive().nullable().meta({
    description: "Maximum kg CO2-eq per kg of product. Null = no limit. Products without CO2 data are not excluded.",
    example: 5,
  }),
  minDeliveryReliability: z.number().min(0).max(1).nullable().meta({
    description: "Minimum delivery reliability (0–1). Null = no minimum. Products without data are not excluded.",
    example: 0.95,
  }),
  preferredOriginCountries: z.array(z.string().regex(/^[a-z]{2}$/)).max(200).meta({
    description: "Countries of origin to prefer (ISO alpha-2, lowercase).",
    example: ["fi", "se"],
  }),
  excludedAllergens: z.array(z.string().min(1)).max(200).meta({
    description:
      "Allergens to avoid: GS1 codes as in the catalog (`AM`, `AW`) or names (`milk`, `gluten`); a name covers all its codes (shared/contracts/allergens.ts).",
    example: ["milk", "AY"],
  }),
  dietaryRestrictions: z.array(z.string().min(1)).max(50).meta({
    description: "Required dietary tags for products the agent picks (e.g. `vegetarian`, `lactose-free`, `gluten-free`).",
    example: ["lactose-free"],
  }),

  // ----- Vendors and brands -----
  preferredVendors: z.array(z.string().min(1)).max(500).meta({
    description: "Vendors to prefer, spelled exactly as in the catalog.",
    example: ["VALIO OY TUORE"],
  }),
  blockedVendors: z.array(z.string().min(1)).max(500).meta({
    description: "Vendors never to order from, spelled exactly as in the catalog.",
  }),
  preferredBrands: z.array(z.string().min(1)).max(500).meta({
    description: "Brands to prefer, spelled as in the catalog.",
    example: ["Valio", "Fazer"],
  }),

  // ----- Products and categories (outside these → approval) -----
  allowedCategories: z.array(z.string().min(1)).max(500).meta({
    description: "Valio category codes the agent may order without approval. Empty = all (except blocked).",
    example: [],
  }),
  blockedCategories: z.array(z.string().min(1)).max(500).meta({
    description: "Valio category codes that always need approval.",
    example: [],
  }),
  allowedProductIds: z.array(z.string().min(1)).max(2000).meta({
    description: "Product codes the agent may order without approval. Empty = all (except blocked).",
    example: [],
  }),
  blockedProductIds: z.array(z.string().min(1)).max(2000).meta({
    description: "Product codes that always need approval.",
    example: [],
  }),

  // ----- Spending and approval -----
  maxOrderValue: z.number().positive().nullable().meta({
    description: "Highest allowed total of one order, EUR excluding VAT. Null = no limit.",
    example: 500,
  }),
  maxUnitPrice: z.number().positive().nullable().meta({
    description: "Unit price (EUR excl. VAT, per sales unit) above which a line needs approval. Null = no cap.",
    example: 50,
  }),
  maxLineQuantity: z.number().positive().nullable().meta({
    description: "Quantity (in sales units) above which a single line needs approval. Null = no cap.",
    example: 1000,
  }),
  autoApproveBelow: z.number().min(0).nullable().meta({
    description:
      "Orders below this total (EUR excluding VAT) are approved automatically. Null = every order needs an approver. Must not exceed maxOrderValue.",
    example: 100,
  }),

  // ----- AI behavior -----
  autonomy: z.enum(["suggest_only", "order_within_limits"]).meta({
    description: "`suggest_only`: the agent only proposes. `order_within_limits`: it may place orders within the limits above.",
  }),
  allowSubstitutes: z.boolean().meta({ description: "May the agent offer or order a substitute when a product is unavailable?" }),
  language: z.enum(["en", "fi", "sv"]).meta({ description: "Language of the agent's answers." }),
});

/** A layer sets only some settings; unknown keys are rejected. */
export const PreferencesLayerValuesSchema = PreferencesSchema.partial().strict();

export const SettingKeySchema = PreferencesSchema.keyof();

export const LayerScopeSchema = z.enum(["base", "buyer", "approver"]).meta({
  description: "`base` applies to everyone in the organization; `buyer` and `approver` apply per role on top of it.",
});

export const PreferenceSourceSchema = z.enum(["default", "organization", "buyer", "approver"]).meta({
  description: "Where an effective value comes from: the system default, the organization base, or the role layer.",
});

// ---------- Layers (approvers only) ----------

export const LayerSchema = z.object({
  scope: LayerScopeSchema,
  values: PreferencesLayerValuesSchema,
  locked: z.array(SettingKeySchema).meta({
    description: "Settings locked by the organization: role layers can't override them. Only the `base` layer has any.",
  }),
  updatedAt: z.iso.datetime().nullable().meta({ description: "Null until the layer is first saved." }),
});

/** GET /api/preferences/layers — response */
export const LayersResponseSchema = z.object({ base: LayerSchema, buyer: LayerSchema, approver: LayerSchema });

/** PUT /api/preferences/layers/{scope} — replaces the layer's settings (and, on `base`, its locks). */
export const UpdateLayerRequestSchema = z.object({
  values: PreferencesLayerValuesSchema,
  locked: z.array(SettingKeySchema).optional().meta({
    description: "Only allowed on `base`. Omit to leave the current locks unchanged; `[]` clears them.",
  }),
});

// ---------- Effective (any member) ----------

export const EffectivePreferencesSchema = z.object({
  values: PreferencesSchema,
  sources: z.record(SettingKeySchema, PreferenceSourceSchema),
  locked: z.array(SettingKeySchema),
});

/** GET /api/preferences/effective — one entry per role the caller holds. */
export const EffectiveResponseSchema = z.object({
  buyer: EffectivePreferencesSchema.optional(),
  approver: EffectivePreferencesSchema.optional(),
});

export type Preferences = z.infer<typeof PreferencesSchema>;
export type PreferencesLayerValues = z.infer<typeof PreferencesLayerValuesSchema>;
export type SettingKey = z.infer<typeof SettingKeySchema>;
export type LayerScope = z.infer<typeof LayerScopeSchema>;
export type PreferenceSource = z.infer<typeof PreferenceSourceSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type LayersResponse = z.infer<typeof LayersResponseSchema>;
export type UpdateLayerRequest = z.infer<typeof UpdateLayerRequestSchema>;
export type EffectivePreferences = z.infer<typeof EffectivePreferencesSchema>;
export type EffectiveResponse = z.infer<typeof EffectiveResponseSchema>;
