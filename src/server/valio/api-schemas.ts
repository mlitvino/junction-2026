import "server-only";

import { z } from "zod";

// Zod mirror of the live Valio Aimo challenge API (docs/valio-aimo-openapi.json).
// Upstream shapes only: what Valio sends and expects. Our normalized types are in ./types.ts.
// The static files are handled offline by src/server/catalog/ (parse, analyze, import).
// Nullable fields follow the spec (anyOf … null). Date/time strings stay strings: their exact
// formats are not documented (timeNow is Helsinki time, requestedDate is "at midnight").

/** Request body of POST /api/price and POST /api/availability. */
export const ValioProductsRequest = z.object({
  /** Customer number. Ignored by the challenge backend, but required. */
  customer: z.string(),
  /** Desired delivery date, YYYY-MM-DD. */
  requestedDate: z.iso.date(),
  /** 1–1 000 product codes; more is rejected with HTTP 422. */
  products: z.array(z.string()).min(1).max(1000),
});
export type ValioProductsRequest = z.infer<typeof ValioProductsRequest>;

// ---------- POST /api/price ----------

export const ValioPrice = z.object({
  value: z.number(),
  valueWithTax: z.number(),
  validFrom: z.string(),
  validTo: z.string(),
  currency: z.string(),
});

export const ValioPriceWithTax = z.object({
  value: z.number(),
  validFrom: z.string(),
  validTo: z.string(),
  currency: z.string(),
});

export const ValioTax = z.object({
  /** Percent, e.g. 14. */
  taxRate: z.number(),
  /** Tax amount in currency. */
  taxValue: z.number(),
});

export const ValioProductPrice = z.object({
  productId: z.string(),
  /** Quantity the price is for (always 1.0). */
  quantity: z.number(),
  /** Price per sales unit before tax (`value`) and with tax (`valueWithTax`). */
  catalogPrice: ValioPrice.nullish(),
  priceWithTax: ValioPriceWithTax.nullish(),
  /** Price per comparisonUnit (KG or L). */
  comparisonPrice: ValioPrice.nullish(),
  comparisonUnit: z.string().nullish(),
  tax: ValioTax.nullish(),
  /** Price before the customer-specific price or discount. */
  listPrice: ValioPrice.nullish(),
  /** True when a customer-specific net price was found, false when the catalog price was used. */
  netPriceFound: z.boolean(),
  /** True when no price could be found for the product. */
  error: z.boolean(),
});
export type ValioProductPrice = z.infer<typeof ValioProductPrice>;

export const ValioPriceResponse = z.object({
  customerId: z.string(),
  currency: z.string(),
  pricingDate: z.string(),
  products: z.array(ValioProductPrice),
});
export type ValioPriceResponse = z.infer<typeof ValioPriceResponse>;

// ---------- POST /api/availability ----------

/** Quantity Valio reports for Terminal (supplier-stocked) products, whose real stock is unknown. */
export const VALIO_UNKNOWN_AMOUNT = 999999;

export const ValioScheduleLine = z.object({
  salesBlock: z.boolean(),
  /** In salesUnit. 0 = not available; 999999 for Terminal products (unknown). */
  availableAmount: z.number(),
  /** Earliest date the amount is available; may differ from the requested date. */
  availableDate: z.string().nullish(),
  salesUnit: z.string(),
});

export const ValioProductAvailability = z.object({
  productId: z.string(),
  /** Order cut-off: order by this time to receive goods on availableDate. */
  closingTime: z.string().nullish(),
  salesBlock: z.boolean(),
  /** "Stock" (Valio's own stock) or "Terminal" (supplier warehouse). */
  logisticModel: z.string().nullish(),
  /** Exactly one entry when available; empty = cannot be delivered on any date. */
  scheduleLines: z.array(ValioScheduleLine),
});
export type ValioProductAvailability = z.infer<typeof ValioProductAvailability>;

export const ValioAvailabilityResponse = z.object({
  timeNow: z.string(),
  requestedDate: z.string(),
  products: z.array(ValioProductAvailability),
});
export type ValioAvailabilityResponse = z.infer<typeof ValioAvailabilityResponse>;

// ---------- Errors ----------

export const ValioValidationError = z.object({
  detail: z
    .array(
      z.object({
        loc: z.array(z.union([z.string(), z.number()])),
        msg: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
});
