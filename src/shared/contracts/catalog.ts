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


/** Source of price and availability data */
export const CatalogDataSourceSchema = z.enum(["valio", "mock"]).meta({
  description:
    "'valio' when fetched from live Valio Aimo API, 'mock' when running in synthetic mock mode.",
  example: "mock",
});

export type CatalogDataSource = z.infer<typeof CatalogDataSourceSchema>;

/** Summary of a Valio Aimo product exposed through the open agent interface */
export const CatalogProductSummarySchema = z.object({
  id: z.string().meta({ description: "Valio product code.", example: "460101" }),
  name: z.string().meta({
    description: "Product name.",
    example: "Valio Oltermanni Creamy Cheese 1kg",
  }),
  brand: z.string().nullable().meta({ example: "Valio" }),
  vendorName: z.string().meta({ example: "Valio Oy" }),
  category: z.string().meta({ description: "Category code.", example: "CHEESE" }),
  salesUnit: z.string().meta({ description: "Sales and pricing unit.", example: "KG" }),
  gtin: z.string().nullable().meta({ example: "6408430001019" }),
  countryOfOrigin: z.string().nullable().meta({ example: "fi" }),
  co2PerKg: z.number().nullable().meta({
    description: "Estimated kg CO2-eq per kg of product (category/group estimate).",
    example: 4.8,
  }),
  deliveryReliability: z.number().min(0).max(1).nullable().meta({
    description: "Historical share of deliveries fulfilled as ordered (0–1).",
    example: 0.98,
  }),
  allergens: z.array(z.string()).meta({
    description: "Normalized allergen identifiers.",
    example: ["milk"],
  }),
  dietaryTags: z.array(z.string()).meta({
    description: "Dietary classifications.",
    example: ["vegetarian", "gluten-free", "lactose-free"],
  }),
  sustainabilityCertificates: z
    .array(z.string())
    .optional()
    .meta({
      description:
        "Sustainability certificates and origin/climate labels present on the product.",
      example: ["Hyvää Suomesta (Produced in Finland)", "Carbo® Climate-Reduced Milk"],
    }),
});

export type CatalogProductSummary = z.infer<typeof CatalogProductSummarySchema>;

/** Detailed Valio Aimo product record including nutrition and suggested substitutes */
export const CatalogProductDetailSchema = CatalogProductSummarySchema.extend({
  baseUnit: z.string().meta({ example: "KG" }),
  allowedLotSize: z.number().meta({ example: 1 }),
  netWeightKg: z.number().nullable().meta({ example: 1 }),
  storageTempC: z
    .object({
      min: z.number().nullable(),
      max: z.number().nullable(),
    })
    .nullable(),
  nutrition: NutritionProfileSchema.nullable().meta({ description: "Per 100 g. Null when the catalog has no nutrition data for the product." }),
  substitutes: z.array(CatalogProductSummarySchema).meta({
    description: "Suggested substitute products within Valio Aimo's assortment.",
  }),
});

export type CatalogProductDetail = z.infer<typeof CatalogProductDetailSchema>;

/** GET /api/catalog/products — query parameters */
export const CatalogSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional().meta({
    description: "Free-text search across product names, brand, vendor, SKU, or GTIN.",
    example: "creamy cheese",
  }),
  category: z.string().trim().optional().meta({
    description: "Filter by product category or type.",
    example: "CHEESE",
  }),
  excludeAllergens: z.string().trim().optional().meta({
    description: "Comma-separated allergens to exclude (e.g. 'soy,tree-nuts').",
    example: "soy,tree-nuts",
  }),
  dietary: z.string().trim().optional().meta({
    description: "Comma-separated required dietary tags (e.g. 'vegetarian,lactose-free').",
    example: "vegetarian",
  }),
  limit: z.coerce.number().int().min(1).max(100).default(20).meta({
    description: "Maximum number of products to return (1–100).",
    example: 20,
  }),
  offset: z.coerce.number().int().min(0).default(0).meta({
    description: "Pagination offset.",
    example: 0,
  }),
});

export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuerySchema>;

/** GET /api/catalog/products — response body */
export const CatalogSearchResponseSchema = z.object({
  total: z.number().int().meta({ example: 12 }),
  items: z.array(CatalogProductSummarySchema),
});

export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponseSchema>;

/** Stock fulfillment classification for an inquired line item */
export const StockStatusSchema = z
  .enum(["in_stock", "partial_stock", "out_of_stock", "terminal_unconfirmed"])
  .meta({
    description:
      "'in_stock': availableQuantity >= requestedQuantity; 'partial_stock': some stock but less than requested; 'out_of_stock': sales-blocked or 0 available; 'terminal_unconfirmed': supplier terminal delivery where exact stock is unconfirmed.",
    example: "in_stock",
  });

export type StockStatus = z.infer<typeof StockStatusSchema>;

/** Single item in a price-and-availability inquiry request */
export const InquiryItemRequestSchema = z.object({
  productId: z.string().trim().min(1).meta({
    description: "Valio product code to inquire about.",
    example: "460101",
  }),
  quantity: z.number().positive().meta({
    description: "Desired quantity in the product's sales unit.",
    example: 420,
  }),
});

export type InquiryItemRequest = z.infer<typeof InquiryItemRequestSchema>;

/** POST /api/inquiries — request body */
export const CreateInquiryRequestSchema = z.object({
  items: z.array(InquiryItemRequestSchema).min(1).max(100).meta({
    description:
      "1–100 narrowed-down products and desired quantities to confirm price and availability.",
  }),
  deliveryDate: z.iso.date().optional().meta({
    description: "Desired delivery date (YYYY-MM-DD). Defaults to today's date if omitted.",
    example: "2026-11-16",
  }),
});

export type CreateInquiryRequest = z.infer<typeof CreateInquiryRequestSchema>;

/** Confirmed fixed-price and availability quote for one product */
export const InquiryLineQuoteSchema = z.object({
  productId: z.string().meta({ example: "460101" }),
  productName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  requestedQuantity: z.number().meta({ example: 420 }),
  salesUnit: z.string().meta({ example: "KG" }),
  priceFound: z.boolean().meta({ example: true }),
  fixedUnitPriceExclVat: z.number().nullable().meta({ example: 5.4 }),
  fixedUnitPriceInclVat: z.number().nullable().meta({ example: 6.16 }),
  vatRatePct: z.number().nullable().meta({ example: 14 }),
  lineTotalExclVat: z.number().nullable().meta({ example: 2268 }),
  lineTotalInclVat: z.number().nullable().meta({ example: 2585.52 }),
  orderable: z.boolean().meta({ example: true }),
  salesBlock: z.boolean().meta({ example: false }),
  logisticModel: z.enum(["stock", "terminal"]).nullable().meta({ example: "stock" }),
  availableQuantity: z.number().nullable().meta({ example: 500 }),
  stockStatus: StockStatusSchema,
  shortfallQuantity: z.number().meta({
    description: "Unfulfilled quantity when stockStatus is partial_stock or out_of_stock.",
    example: 0,
  }),
  canFulfillRequestedQuantity: z.boolean().meta({ example: true }),
  earliestAvailableDate: z.string().nullable().meta({ example: "2026-11-16" }),
  orderCutoff: z.string().nullable().meta({ example: "2026-11-16T10:00:00" }),
  fetchedAt: z.iso.datetime(),
});

export type InquiryLineQuote = z.infer<typeof InquiryLineQuoteSchema>;

/** Confirmed price-and-availability inquiry response (used before order commitment) */
export const PriceAvailabilityInquirySchema = z.object({
  inquiryId: z.string().meta({ example: "INQ-9F3A1B2C" }),
  deliveryDate: z.iso.date().meta({ example: "2026-11-16" }),
  quotedAt: z.iso.datetime(),
  validUntil: z.iso.datetime().meta({
    description: "Timestamp until which the quoted fixed prices are locked.",
  }),
  source: CatalogDataSourceSchema,
  currency: z.literal("EUR"),
  lines: z.array(InquiryLineQuoteSchema),
  totalExclVatEur: z.number().meta({ example: 2268 }),
  totalInclVatEur: z.number().meta({ example: 2585.52 }),
  allOrderable: z.boolean().meta({
    description:
      "True when every inquired item has a valid price and can fulfill the requested quantity.",
    example: true,
  }),
  unknownProductIds: z.array(z.string()),
});

export type PriceAvailabilityInquiry = z.infer<typeof PriceAvailabilityInquirySchema>;
