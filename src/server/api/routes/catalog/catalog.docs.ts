import "server-only";

import { createRoute, z } from "@hono/zod-openapi";

import {
  CatalogProductDetailSchema,
  CatalogSearchQuerySchema,
  CatalogSearchResponseSchema,
} from "@/shared/contracts/catalog";
import { ErrorResponseSchema } from "@/shared/contracts/errors";

export const searchCatalogProductsRoute = createRoute({
  method: "get",
  path: "/catalog/products",
  tags: ["Catalog"],
  summary: "Search Valio Aimo products by name, category, allergens, and dietary tags",
  description:
    "Structured machine-readable catalog search. External purchasing agents should narrow down " +
    "candidate products here before calling POST /api/inquiries for live prices and stock.",
  request: {
    query: CatalogSearchQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated list of matching Valio Aimo products.",
      content: { "application/json": { schema: CatalogSearchResponseSchema } },
    },
  },
});

export const getCatalogProductRoute = createRoute({
  method: "get",
  path: "/catalog/products/{productId}",
  tags: ["Catalog"],
  summary: "Get detailed Valio Aimo product metadata and suggested substitutes",
  description:
    "Returns full product attributes including nutritional profile, normalized allergens, " +
    "dietary tags, delivery reliability, CO2 footprint, and Valio substitute products.",
  request: {
    params: z.object({
      productId: z.string().min(1).meta({ example: "460101" }),
    }),
  },
  responses: {
    200: {
      description: "Product detail and substitutes.",
      content: { "application/json": { schema: CatalogProductDetailSchema } },
    },
    404: {
      description: "Product not found.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
