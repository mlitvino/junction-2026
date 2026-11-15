import { z } from "zod";

// Products, prices and availability from the Valio catalog, as the API returns them.
// Products come from Postgres (loaded by `pnpm data:import`); prices and availability are live
// Valio answers (cached up to 5 minutes by server/services/catalog.ts).

const productId = z.string().min(1).meta({ description: "Valio product code.", example: "460000" });
const isoDate = z.iso.date().meta({ description: "Delivery date, YYYY-MM-DD.", example: "2026-11-16" });

/** Where live data came from: the Valio API, or deterministic fake data when no API key is set. */
export const DataSourceSchema = z
  .enum(["valio", "mock"])
  .meta({ description: "`valio`: live Valio API. `mock`: fake data (server has no Valio API key)." });

// ---------- Products ----------

// Fields added after the first release have defaults, so producers written against the older
// contract (e.g. frontend mocks that parse their fixtures) keep working; parsed values always have them.
export const ProductSummarySchema = z.object({
  id: productId,
  name: z.string().meta({ description: "English name (Finnish if no translation)." }),
  brand: z.string().nullable(),
  vendorName: z.string(),
  category: z.string().meta({ description: "Valio category code." }),
  salesUnit: z.string().meta({ description: "Unit the product is sold and priced in (e.g. KI = case, ST = piece, KG).", example: "ST" }),
  gtin: z.string().nullable().meta({ description: "GTIN of the sales unit. Codes starting 20–29 are in-store codes." }),
  temperatureCondition: z.number().int().nullable().meta({
    description: "Valio temperature class: 1–4 chilled, 7 frozen, 8 ambient. Not always consistent with storageTempC.",
  }),
  countryOfOrigin: z.string().nullable().meta({ description: "ISO alpha-2, lowercase.", example: "fi" }),
  co2PerKg: z.number().nullable().meta({
    description: "kg CO2-eq per kg of product. An average per product group, not a per-product measurement. Null = unknown.",
  }),
  deliveryReliability: z.number().min(0).max(1).nullable().meta({
    description: "Share of deliveries delivered as ordered, 0–1. Null = unknown.",
  }),
  hasImage: z.boolean(),
  allergens: z.array(z.string()).meta({ description: "GS1 allergen codes it contains (see shared/contracts/allergens.ts).", example: ["AM"] }),
  allergenNames: z.array(z.string()).default([]).meta({ description: "The contained allergens as names.", example: ["milk"] }),
  mayContainAllergens: z.array(z.string()).default([]).meta({ description: "GS1 codes it may contain (cross-contamination)." }),
  dietaryTags: z.array(z.string()).default([]).meta({
    description: "From the product's declared claims: lactose-free, gluten-free, vegan, vegetarian.",
    example: ["lactose-free"],
  }),
  labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]).meta({
    description: "Packaging labels and certificates (e.g. Hyvää Suomesta, EU organic, MSC).",
  }),
  contentPerSalesUnit: z
    .object({ value: z.number(), unit: z.enum(["L", "KG"]) })
    .nullable()
    .default(null)
    .meta({ description: "Net content of one sales unit (e.g. 5 L per case). Null when not declared." }),
});

export const ProductNutritionSchema = z
  .object({
    energyKcal: z.number().nullable(),
    fat: z.number().nullable(),
    saturatedFat: z.number().nullable(),
    carbohydrate: z.number().nullable(),
    sugars: z.number().nullable(),
    protein: z.number().nullable(),
    salt: z.number().nullable(),
    fibre: z.number().nullable(),
  })
  .meta({ description: "Per 100 g or ml (grams; energy in kcal), as declared by the supplier." });

export const ProductUnitSchema = z.object({
  unitId: z.string().meta({ example: "KI" }),
  gtin: z.string().nullable(),
  sizeInBaseUnits: z.number().meta({ description: "How many base units one of this unit contains." }),
});

export const ProductDetailSchema = ProductSummarySchema.extend({
  names: z.object({ en: z.string().nullable(), fi: z.string().nullable(), sv: z.string().nullable() }),
  baseUnit: z.string(),
  allowedLotSize: z.number(),
  units: z.array(ProductUnitSchema),
  allergens: z.array(z.string()).meta({ description: "GS1 allergen codes." }),
  storageTempC: z
    .object({ min: z.number().nullable(), max: z.number().nullable() })
    .nullable()
    .meta({ description: "Storage temperature range in °C (Synkka). Prefer it over temperatureCondition." }),
  netWeightKg: z.number().nullable().meta({ description: "Net weight of one base unit." }),
  co2PerBaseUnit: z.number().nullable().meta({ description: "co2PerKg × netWeightKg." }),
  vatCode: z.string().nullable(),
  nutrition: ProductNutritionSchema.nullable().default(null),
  claims: z.array(z.string()).default([]).meta({ description: "Declared claims, e.g. FREE_FROM_LACTOSE, VEGAN, HIGH_PROTEIN." }),
  substitutes: z.array(ProductSummarySchema).meta({ description: "Products Valio suggests instead of this one." }),
});

export const ProductSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional().meta({
    description: "Words to find in names (en/fi/sv), brand, vendor, product code or GTIN. All words must match.",
    example: "potato salad",
  }),
  category: z.string().optional().meta({ description: "Exact category code." }),
  excludeAllergens: z.string().trim().optional().meta({
    description: "Comma-separated allergens to exclude, names or GS1 codes (e.g. 'milk,AY').",
    example: "soy,tree-nuts",
  }),
  excludeMayContain: z
    .enum(["true", "false"])
    .optional()
    .meta({ description: "`true`: also exclude products that may contain them (cross-contamination)." }),
  dietary: z.string().trim().optional().meta({
    description: "Comma-separated required tags: lactose-free, gluten-free, vegan, vegetarian.",
    example: "lactose-free",
  }),
  origin: z.string().trim().optional().meta({ description: "Comma-separated ISO alpha-2 countries.", example: "fi,se" }),
  maxCo2PerKg: z.coerce.number().positive().optional().meta({
    description: "Max kg CO2-eq per kg. Products without CO2 data are kept.",
  }),
  minReliability: z.coerce.number().min(0).max(1).optional().meta({
    description: "Min delivery reliability (0–1). Products without data are kept.",
  }),
  vendor: z.string().trim().max(200).optional().meta({ description: "Vendor name contains this." }),
  brand: z.string().trim().max(200).optional().meta({ description: "Brand contains this." }),
  label: z.string().trim().optional().meta({ description: "Has this label id (see shared/contracts/labels.ts).", example: "EU_ORGANIC_FARMING" }),
  sort: z.enum(["relevance", "name", "co2", "reliability"]).optional().meta({
    description:
      "`relevance`: closest name match to `q` first (the default when `q` is given, else `name`). `co2`: lowest first; " +
      "`reliability`: highest first (unknowns last). Price ranking: POST /api/products/rank.",
  }),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ProductSearchResponseSchema = z.object({
  total: z.number().int().meta({ description: "Matches in total (for paging)." }),
  items: z.array(ProductSummarySchema),
  matchedFuzzy: z.boolean().optional().meta({
    description: "True when nothing matched as typed and the results are for corrected words (a typo like 'mlik').",
  }),
  searchedFor: z.string().optional().meta({
    description: "With matchedFuzzy: the corrected words the results are for, e.g. 'milk' (show \"Showing results for …\").",
    example: "milk",
  }),
});

// ---------- Prices ----------

const productIds = z
  .array(productId)
  .min(1)
  .max(100)
  .meta({ description: "1–100 product codes. Narrow down first: Valio rate-limits these calls." });

export const PricesRequestSchema = z.object({ productIds, date: isoDate });

export const PriceQuoteSchema = z.object({
  productId,
  found: z.boolean().meta({ description: "False when Valio has no price for the product (other price fields are null)." }),
  salesUnit: z.string().meta({ description: "The price is per one of this unit." }),
  priceExclVat: z.number().nullable(),
  priceInclVat: z.number().nullable(),
  vatRatePct: z.number().nullable(),
  listPriceExclVat: z.number().nullable().meta({ description: "Price before customer discount." }),
  customerPrice: z.boolean().meta({ description: "True when a customer-specific net price applies." }),
  comparisonPrice: z.number().nullable().meta({ description: "Price per comparisonUnit, for comparing pack sizes." }),
  comparisonUnit: z.string().nullable().meta({ example: "KG" }),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  fetchedAt: z.iso.datetime().meta({ description: "When this price was fetched from Valio (cached up to 5 minutes)." }),
  snapshotId: z.string().optional().meta({ description: "Id of the recorded Valio answer (snapshot) this comes from; quote it to trace a price or stock figure. Always set by the server.", example: "18342" }),
});

export const PricesResponseSchema = z.object({
  pricingDate: isoDate,
  currency: z.string().meta({ example: "EUR" }),
  source: DataSourceSchema,
  quotes: z.array(PriceQuoteSchema),
  unknownProductIds: z.array(z.string()).meta({ description: "Requested codes that are not in the catalog." }),
});

// ---------- Availability ----------

export const AvailabilityRequestSchema = z.object({ productIds, date: isoDate });

export const AvailabilitySchema = z.object({
  productId,
  orderable: z.boolean().meta({ description: "Not sales-blocked and some quantity is available on some date." }),
  salesBlock: z.boolean(),
  logisticModel: z.enum(["stock", "terminal"]).nullable().meta({
    description: "`stock`: Valio's own stock, quantity known. `terminal`: supplier warehouse, quantity unknown.",
  }),
  availableQuantity: z.number().nullable().meta({
    description: "In salesUnit. Null when unknown (terminal products) or nothing is available.",
  }),
  availableDate: z.string().nullable().meta({ description: "Earliest delivery date; may be later than requested." }),
  orderCutoff: z.string().nullable().meta({ description: "Order by this time to receive goods on availableDate." }),
  salesUnit: z.string().nullable(),
  fetchedAt: z.iso.datetime(),
  snapshotId: z.string().optional().meta({ description: "Id of the recorded Valio answer (snapshot) this comes from; quote it to trace a price or stock figure. Always set by the server.", example: "18342" }),
});

export const AvailabilityResponseSchema = z.object({
  requestedDate: isoDate,
  source: DataSourceSchema,
  items: z.array(AvailabilitySchema),
  unknownProductIds: z.array(z.string()),
});

export type DataSource = z.infer<typeof DataSourceSchema>;
export type ProductNutrition = z.infer<typeof ProductNutritionSchema>;
export type ProductSummary = z.infer<typeof ProductSummarySchema>;
export type ProductUnit = z.infer<typeof ProductUnitSchema>;
export type ProductDetail = z.infer<typeof ProductDetailSchema>;
export type ProductSearchQuery = z.infer<typeof ProductSearchQuerySchema>;
export type ProductSearchResponse = z.infer<typeof ProductSearchResponseSchema>;
export type PricesRequest = z.infer<typeof PricesRequestSchema>;
export type PriceQuote = z.infer<typeof PriceQuoteSchema>;
export type PricesResponse = z.infer<typeof PricesResponseSchema>;
export type AvailabilityRequest = z.infer<typeof AvailabilityRequestSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;

// ---------- Offers (price + availability for one delivery date) ----------

export const OfferSchema = z.object({
  productId,
  date: isoDate,
  price: PriceQuoteSchema.nullable().meta({ description: "Null when Valio returned no price answer at all." }),
  availability: AvailabilitySchema.nullable().meta({ description: "Null when Valio returned no availability answer." }),
});

const optionalDate = isoDate.optional().meta({
  description: "Delivery date, YYYY-MM-DD. Defaults to today (Europe/Helsinki).",
  example: "2026-11-16",
});

export const OfferQuerySchema = z.object({ date: optionalDate });

export const OffersRequestSchema = z.object({
  productIds: z.array(productId).min(1).max(50).meta({
    description: "1–50 product codes. Narrow down with the product search first: Valio rate-limits.",
  }),
  date: optionalDate,
});

export const OffersResponseSchema = z.object({
  date: isoDate,
  source: DataSourceSchema,
  currency: z.string().meta({ example: "EUR" }),
  offers: z.array(OfferSchema),
  unknownProductIds: z.array(z.string()).meta({ description: "Requested codes that are not in the catalog." }),
});

export type Offer = z.infer<typeof OfferSchema>;
export type OffersRequest = z.infer<typeof OffersRequestSchema>;
export type OffersResponse = z.infer<typeof OffersResponseSchema>;

// ---------- Ranking (good / better / best) ----------

export const RankProductsRequestSchema = z
  .object({
    q: z.string().trim().max(200).optional().meta({ description: "What is needed, e.g. 'lactose-free milk'." }),
    productIds: z.array(productId).min(1).max(20).optional().meta({ description: "Rank these instead of searching." }),
    quantity: z.number().positive().meta({ description: "How much is needed.", example: 1000 }),
    unit: z.string().trim().max(20).optional().meta({
      description: "Unit of `quantity`: L, dl, ml, kg, g, cases, pcs or a product unit code. Empty = sales units.",
      example: "L",
    }),
    date: z.iso.date().optional().meta({ description: "Delivery date the goods are needed. Defaults to today (Helsinki)." }),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .refine((v) => !!v.q || !!v.productIds?.length, { message: "Give `q` or `productIds`", path: ["q"] });

export const RankedProductSchema = z.object({
  product: ProductSummarySchema,
  tier: z.enum(["best", "better", "good"]).nullable(),
  score: z.number().meta({ description: "0–1, weighted: price 35%, availability 25%, relevance, reliability, CO2, preferences 10% each." }),
  quantity: z.number().meta({ description: "The requested amount in this product's sales units (rounded up)." }),
  salesUnit: z.string(),
  conversion: z.object({ converted: z.boolean(), note: z.string() }),
  unitPriceExclVat: z.number(),
  lineTotalExclVat: z.number(),
  pricePerContent: z.object({ value: z.number(), unit: z.enum(["L", "KG"]) }).nullable(),
  availableDate: z.string().nullable(),
  availableQuantity: z.number().nullable(),
  priceSnapshotId: z.string().nullable().meta({ description: "Snapshot id of the price used." }),
  availabilitySnapshotId: z.string().nullable().meta({ description: "Snapshot id of the availability used." }),
  reasons: z.array(z.string()).meta({ description: "Why it ranks where it does, per factor." }),
});

export const RankProductsResponseSchema = z.object({
  date: z.iso.date(),
  source: DataSourceSchema,
  best: RankedProductSchema.nullable(),
  better: RankedProductSchema.nullable(),
  good: RankedProductSchema.nullable(),
  ranked: z.array(RankedProductSchema).meta({ description: "All orderable candidates, best first." }),
  unavailable: z.array(z.object({ product: ProductSummarySchema, reason: z.string() })),
  excluded: z
    .array(z.object({ product: ProductSummarySchema, reasons: z.array(z.string()) }))
    .meta({ description: "Matches the organization's rules exclude (allergens, dietary, blocked vendor)." }),
});

export type RankProductsRequest = z.infer<typeof RankProductsRequestSchema>;
export type RankedProduct = z.infer<typeof RankedProductSchema>;
export type RankProductsResponse = z.infer<typeof RankProductsResponseSchema>;
