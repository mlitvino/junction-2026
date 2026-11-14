import "server-only";

import { getCatalogProductDetail, searchCatalogProducts } from "@/server/services/inquiry";
import {
  CatalogProductDetailSchema,
  CatalogSearchResponseSchema,
} from "@/shared/contracts/catalog";

import { createRouter } from "../../router";
import { getCatalogProductRoute, searchCatalogProductsRoute } from "./catalog.docs";

export const catalogRouter = createRouter()
  .openapi(searchCatalogProductsRoute, async (c) => {
    const result = await searchCatalogProducts(c.req.valid("query"));
    return c.json(CatalogSearchResponseSchema.parse(result), 200);
  })
  .openapi(getCatalogProductRoute, async (c) => {
    const product = await getCatalogProductDetail(c.req.valid("param").productId);
    if (!product) return c.json({ error: "Product not found" }, 404);
    return c.json(CatalogProductDetailSchema.parse(product), 200);
  });
