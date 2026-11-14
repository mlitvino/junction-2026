// Scenario 3: catalog — one search with filters, details, offers with snapshot ids, ranking, substitutes.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ProductSubstitutionResponseSchema } from "@/shared/contracts/intelligence";
import {
  OffersResponseSchema,
  ProductDetailSchema,
  ProductSearchResponseSchema,
  RankProductsResponseSchema,
} from "@/shared/contracts/products";

import { expectStatus, ok } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { deliveryDate, newOrg, orderableProducts, RUN, type Org } from "./lib/fixtures.ts";

describe("catalog", () => {
  let org: Org;
  const date = deliveryDate();
  before(async () => {
    org = await newOrg("cat");
  });
  after(() => cleanup(RUN));

  it("searches with dietary, origin and allergen filters", async () => {
    const r = ok(
      await org.buyer.get("/api/products?q=milk&dietary=lactose-free&origin=fi&excludeAllergens=soy&sort=co2&limit=10"),
      200,
      ProductSearchResponseSchema,
      "filtered search",
    );
    assert.ok(r.items.length > 0, "Finnish lactose-free milk exists in the catalog");
    for (const p of r.items) {
      assert.ok(p.dietaryTags.includes("lactose-free"), `${p.id} is lactose-free`);
      assert.equal(p.countryOfOrigin, "fi");
      assert.ok(!p.allergens.includes("AY"), `${p.id} has no soy`);
    }
  });

  it("product details carry content, labels, allergens split by qualifier, nutrition and claims", async () => {
    const [first] = await orderableProducts(org.buyer, date);
    const d = ok(await org.buyer.get(`/api/products/${first!.id}`), 200, ProductDetailSchema, "product detail");
    assert.equal(d.id, first!.id);
    assert.ok(Array.isArray(d.mayContainAllergens) && Array.isArray(d.allergenNames) && Array.isArray(d.claims));
    expectStatus(await org.buyer.get("/api/products/no-such-product"), 404, "unknown product");
  });

  it("every price and availability answer names its snapshot", async () => {
    const picks = await orderableProducts(org.buyer, date);
    const r = ok(
      await org.buyer.post("/api/offers", { productIds: picks.slice(0, 3).map((p) => p.id), date }),
      200,
      OffersResponseSchema,
      "offers",
    );
    for (const o of r.offers) {
      assert.ok(o.price?.snapshotId, `${o.productId}: price snapshotId`);
      assert.ok(o.availability?.snapshotId, `${o.productId}: availability snapshotId`);
    }
  });

  it("the retired catalog routes are gone", async () => {
    expectStatus(await org.buyer.get("/api/catalog/products?q=milk"), 404, "/api/catalog/products");
  });

  it("ranks 1000 L of lactose-free milk: best/better/good in sales units, with reasons", async () => {
    const r = ok(
      await org.buyer.post("/api/products/rank", { q: "lactose-free milk", quantity: 1000, unit: "L", date }),
      200,
      RankProductsResponseSchema,
      "rank",
    );
    assert.ok(r.best, "a best choice");
    assert.ok(r.best.reasons.length > 0);
    assert.ok(r.best.priceSnapshotId, "the price used is traceable");
    const content = r.best.product.contentPerSalesUnit;
    if (content?.unit === "L") {
      const litres = r.best.quantity * content.value;
      assert.ok(litres >= 1000 && litres < 1000 + content.value, `${r.best.quantity} × ${content.value} L covers 1000 L`);
    }
    const scores = r.ranked.map((x) => x.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "ranked best first");
  });

  it("suggests substitutes for a product", async () => {
    const [first] = await orderableProducts(org.buyer, date);
    ok(
      await org.buyer.post(`/api/products/${first!.id}/substitutes`, { requestedQuantity: 10, deliveryDate: date }),
      200,
      ProductSubstitutionResponseSchema,
      "substitutes",
    );
  });
});
