import "server-only";

// Normalized Valio types for the running server (agent tools, services). The schemas live in
// shared/contracts/products.ts because the HTTP API (routes/products) returns them too.
export {
  DataSourceSchema,
  ProductSummarySchema,
  ProductUnitSchema,
  ProductDetailSchema,
  ProductSearchQuerySchema,
  ProductSearchResponseSchema,
  PricesRequestSchema,
  PriceQuoteSchema,
  PricesResponseSchema,
  AvailabilityRequestSchema,
  AvailabilitySchema,
  AvailabilityResponseSchema,
} from "@/shared/contracts/products";
export type {
  DataSource,
  ProductSummary,
  ProductUnit,
  ProductDetail,
  ProductSearchQuery,
  ProductSearchResponse,
  PricesRequest,
  PriceQuote,
  PricesResponse,
  AvailabilityRequest,
  Availability,
  AvailabilityResponse,
} from "@/shared/contracts/products";
