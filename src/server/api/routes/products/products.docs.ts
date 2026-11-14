import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import { ErrorResponseSchema } from "@/shared/contracts/errors";
import {
  OfferQuerySchema,
  OfferSchema,
  OffersRequestSchema,
  OffersResponseSchema,
  ProductDetailSchema,
  ProductSearchQuerySchema,
  ProductSearchResponseSchema,
  RankProductsRequestSchema,
  RankProductsResponseSchema,
} from "@/shared/contracts/products";
import { ProductSubstitutionRequestSchema, ProductSubstitutionResponseSchema } from "@/shared/contracts/intelligence";

// OpenAPI definitions for the catalog routes. Handlers live in ./products.ts.

const security = [{ sessionCookie: [] }];
const error = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponseSchema } },
});
const authErrors = { 401: error("No valid session."), 403: error("The user is neither buyer nor approver.") };
const upstreamError = error("The Valio API failed or is unreachable.");

const ProductIdParamSchema = z.object({
  id: z.string().min(1).meta({ description: "Valio product code.", example: "460000" }),
});

export const searchProductsRoute = createRoute({
  method: "get",
  path: "/products",
  tags: ["Catalog"],
  summary: "Search products",
  description:
    "Searches the static Valio product data (names, brand, vendor, code, GTIN; all words must match). " +
    "Reads Postgres only: no price, stock or Valio call. Use `/products/{id}/offer` or `/offers` for those.",
  security,
  request: { query: ProductSearchQuerySchema },
  responses: {
    200: { description: "Matching products.", content: { "application/json": { schema: ProductSearchResponseSchema } } },
    ...authErrors,
  },
});

export const getProductRoute = createRoute({
  method: "get",
  path: "/products/{id}",
  tags: ["Catalog"],
  summary: "Product details",
  description: "Static product data with units, allergens and suggested substitutes. No Valio call.",
  security,
  request: { params: ProductIdParamSchema },
  responses: {
    200: { description: "The product.", content: { "application/json": { schema: ProductDetailSchema } } },
    404: error("No such product."),
    ...authErrors,
  },
});

export const getProductOfferRoute = createRoute({
  method: "get",
  path: "/products/{id}/offer",
  tags: ["Catalog"],
  summary: "Price and availability of one product",
  description:
    "Live price, stock and earliest delivery date from Valio for one delivery date (default today). " +
    "Answers are cached for 5 minutes and every answer is stored as an audit snapshot.",
  security,
  request: { params: ProductIdParamSchema, query: OfferQuerySchema },
  responses: {
    200: { description: "The offer.", content: { "application/json": { schema: OfferSchema } } },
    404: error("No such product."),
    502: upstreamError,
    ...authErrors,
  },
});

export const getOffersRoute = createRoute({
  method: "post",
  path: "/offers",
  tags: ["Catalog"],
  summary: "Prices and availability of several products",
  description:
    "Live price, stock and earliest delivery date for up to 50 products at once. " +
    "Codes that aren't in the catalog are listed in `unknownProductIds`.",
  security,
  request: { body: { content: { "application/json": { schema: OffersRequestSchema } }, required: true } },
  responses: {
    200: { description: "The offers.", content: { "application/json": { schema: OffersResponseSchema } } },
    502: upstreamError,
    ...authErrors,
  },
});

export const rankProductsRoute = createRoute({
  method: "post",
  path: "/products/rank",
  tags: ["Catalog"],
  summary: "Good / better / best for a need",
  description:
    "Finds candidates (`q`) or takes `productIds`, drops what the organization's rules exclude (allergens, dietary, " +
    "blocked vendors; listed in `excluded`), converts `quantity` + `unit` (e.g. 1000 L) into each product's sales " +
    "units, asks Valio for prices and availability on `date`, and ranks: price per litre/kg 35%, availability 25%, " +
    "relevance, reliability, CO2 and preferred origin/vendor/brand or sustainability labels 10% each. Every product " +
    "gets its reasons.",
  security,
  request: { body: { content: { "application/json": { schema: RankProductsRequestSchema } }, required: true } },
  responses: {
    200: { description: "Ranking.", content: { "application/json": { schema: RankProductsResponseSchema } } },
    502: upstreamError,
    ...authErrors,
  },
});

export const productSubstitutesRoute = createRoute({
  method: "post",
  path: "/products/{id}/substitutes",
  tags: ["Catalog"],
  summary: "Allergen-safe substitutes for a product",
  description:
    "Best / better / good substitutes that satisfy the organization's dietary and allergen rules, with price, " +
    "delivery and CO2 trade-offs and a split plan when stock is short.",
  security,
  request: {
    params: ProductIdParamSchema,
    body: {
      content: { "application/json": { schema: ProductSubstitutionRequestSchema.omit({ productId: true }) } },
      required: true,
    },
  },
  responses: {
    200: { description: "Substitutes.", content: { "application/json": { schema: ProductSubstitutionResponseSchema } } },
    404: error("No such product."),
    ...authErrors,
  },
});
