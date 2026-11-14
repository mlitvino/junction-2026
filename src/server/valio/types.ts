import "server-only";

import { z } from "zod";

// Normalized Valio types for the running server: products (from Postgres, loaded by
// `pnpm data:import`) plus live prices and availability from the Valio API. Returned by
// server/services/catalog.ts; meant for agent tools and any server code that works with products.
// Zod schemas (with descriptions) so agent tools can reuse them as input/output schemas.
// Not exposed over HTTP: if an endpoint ever needs them, move them to shared/contracts first.

const productId = z.string().min(1).meta({ description: "Valio product code.", example: "460000" });
const isoDate = z.iso.date().meta({ description: "Delivery date, YYYY-MM-DD.", example: "2026-11-16" });

/** Where live data came from: the Valio API, or deterministic fake data when no API key is set. */
export const DataSourceSchema = z
  .enum(["valio", "mock"])
  .meta({ description: "`valio`: live Valio API. `mock`: fake data (server has no Valio API key)." });

// ---------- Products ----------

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
});

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
  substitutes: z.array(ProductSummarySchema).meta({ description: "Products Valio suggests instead of this one." }),
});

export const ProductSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional().meta({
    description: "Words to find in names (en/fi/sv), brand, vendor, product code or GTIN. All words must match.",
    example: "potato salad",
  }),
  category: z.string().optional().meta({ description: "Exact category code." }),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ProductSearchResponseSchema = z.object({
  total: z.number().int().meta({ description: "Matches in total (for paging)." }),
  items: z.array(ProductSummarySchema),
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
});

export const AvailabilityResponseSchema = z.object({
  requestedDate: isoDate,
  source: DataSourceSchema,
  items: z.array(AvailabilitySchema),
  unknownProductIds: z.array(z.string()),
});

export type DataSource = z.infer<typeof DataSourceSchema>;
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
