import "server-only";

import { getOffers, getProduct, searchProducts } from "@/server/services/catalog";
import { evaluateProductSubstitutions, IntelligenceServiceError } from "@/server/services/intelligence";
import { actorFor } from "@/server/services/purchasing";
import { ValioApiError } from "@/server/valio/client";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import {
  getOffersRoute,
  getProductOfferRoute,
  getProductRoute,
  productSubstitutesRoute,
  searchProductsRoute,
} from "./products.docs";

export const productsRouter = createRouter();

// Buyers and approvers only. Separate statements: `.use()` returns a plain Hono type, so
// chaining `.openapi()` after it doesn't type-check.
productsRouter.use("/products", requireRole("buyer", "approver"));
productsRouter.use("/products/*", requireRole("buyer", "approver"));
productsRouter.use("/offers", requireRole("buyer", "approver"));

/** Valio failures become 502 without leaking upstream details; anything else is a 500. */
function upstreamFailure(err: unknown): never | null {
  if (err instanceof ValioApiError) {
    console.error("Valio request failed", err.status, err.message);
    return null;
  }
  throw err;
}

productsRouter.openapi(searchProductsRoute, async (c) =>
  c.json(await searchProducts(c.req.valid("query")), 200),
);

productsRouter.openapi(getProductRoute, async (c) => {
  const product = await getProduct(c.req.valid("param").id);
  if (!product) return c.json({ error: "Product not found" }, 404);
  return c.json(product, 200);
});

productsRouter.openapi(getProductOfferRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { date } = c.req.valid("query");
  try {
    const result = await getOffers([id], date);
    const offer = result.offers[0];
    if (!offer) return c.json({ error: "Product not found" }, 404);
    return c.json(offer, 200);
  } catch (err) {
    upstreamFailure(err);
    return c.json({ error: "Valio is unavailable" }, 502);
  }
});

productsRouter.openapi(getOffersRoute, async (c) => {
  const { productIds, date } = c.req.valid("json");
  try {
    return c.json(await getOffers(productIds, date), 200);
  } catch (err) {
    upstreamFailure(err);
    return c.json({ error: "Valio is unavailable" }, 502);
  }
});

productsRouter.openapi(productSubstitutesRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    return c.json(await evaluateProductSubstitutions({ ...body, productId: c.req.valid("param").id }, c.var.user), 200);
  } catch (err) {
    if (err instanceof IntelligenceServiceError && err.status === 404) return c.json({ error: err.message }, 404);
    throw err;
  }
});
