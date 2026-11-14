import "server-only";

import { getCatalogProductDetail, searchCatalogProducts } from "@/server/services/inquiry";
import {
  evaluateProductSubstitutions,
  IntelligenceServiceError,
} from "@/server/services/intelligence";
import {
  CatalogProductDetailSchema,
  CatalogSearchResponseSchema,
} from "@/shared/contracts/catalog";
import { ProductSubstitutionResponseSchema } from "@/shared/contracts/intelligence";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  getCatalogProductRoute,
  postCatalogSubstitutionsRoute,
  searchCatalogProductsRoute,
} from "./catalog.docs";

// Session required (default-deny in app.ts); roles per path. Separate statements: `.use()`/`.on()`
// return a plain Hono type, so chaining `.openapi()` after them doesn't type-check.
export const catalogRouter = createRouter();
catalogRouter.use("/catalog/*", requireRole("buyer", "approver"));

catalogRouter
  .openapi(searchCatalogProductsRoute, async (c) => {
    const result = await searchCatalogProducts(c.req.valid("query"));
    return c.json(CatalogSearchResponseSchema.parse(result), 200);
  })
  .openapi(getCatalogProductRoute, async (c) => {
    const product = await getCatalogProductDetail(c.req.valid("param").productId);
    if (!product) return c.json({ error: "Product not found" }, 404);
    return c.json(CatalogProductDetailSchema.parse(product), 200);
  })
  .openapi(postCatalogSubstitutionsRoute, async (c) => {
    const actor = c.var.user;
    try {
      const result = await evaluateProductSubstitutions(c.req.valid("json"), actor);
      return c.json(ProductSubstitutionResponseSchema.parse(result), 200);
    } catch (err) {
      if (err instanceof IntelligenceServiceError && err.status === 404) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });
