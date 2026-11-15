// Scenario 9: recipe planning — scale a recipe, subtract kitchen stock, propose only what's missing.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { InventoryItemSchema } from "@/shared/contracts/inventory";
import { CreateOrderFromRecipeResponseSchema, RecipeSchema } from "@/shared/contracts/recipes";

import { expectStatus, ok } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { deliveryDate, newOrg, RUN, type Org } from "./lib/fixtures.ts";

describe("recipes and inventory", () => {
  let org: Org;
  let recipeId: string;
  const date = deliveryDate();

  before(async () => {
    org = await newOrg("rec");
  });
  after(() => cleanup(RUN));

  it("a buyer saves a recipe and the kitchen's stock", async () => {
    const recipe = ok(
      await org.buyer.post("/api/recipes", {
        name: `${RUN} porridge`,
        baseServings: 10,
        ingredients: [
          { productName: "Lactose-free milk", productType: "Milk", quantity: 20, unit: "L" },
          { productName: "Butter", productType: "Butter", quantity: 1, unit: "KG" },
        ],
      }),
      200,
      RecipeSchema,
      "create recipe",
    );
    recipeId = recipe.id;
    assert.equal(recipe.source, "customer");

    ok(
      await org.buyer.post("/api/inventory/items", {
        ingredientName: "Lactose-free milk",
        productType: "Milk",
        quantityInStock: 5,
        unit: "L",
      }),
      200,
      InventoryItemSchema,
      "milk in stock",
    );
    ok(
      await org.buyer.post("/api/inventory/items", { ingredientName: "Butter", productType: "Butter", quantityInStock: 3, unit: "KG" }),
      200,
      InventoryItemSchema,
      "butter in stock",
    );
  });

  it("from-recipe proposes only what stock doesn't cover", async () => {
    const r = ok(
      await org.buyer.post("/api/proposals/from-recipe", { recipeId, servings: 10, deliveryDate: date }),
      201,
      CreateOrderFromRecipeResponseSchema,
      "from-recipe",
    );
    const milk = r.ingredientReconciliation.find((i) => /milk/i.test(i.productName))!;
    const butter = r.ingredientReconciliation.find((i) => /butter/i.test(i.productName))!;
    assert.equal(milk.totalNeededQuantity, 20);
    assert.equal(milk.inventoryStockQuantity, 5);
    assert.equal(milk.actuallyNeededQuantity, 15, "20 L needed − 5 L in stock");
    assert.equal(butter.coveredByInventory, true, "3 kg in stock covers 1 kg");

    assert.ok(r.proposal, r.message);
    assert.equal(r.proposal.source, "recipe");
    assert.equal(r.proposal.lines.length, 1, "only the milk is ordered");
    assert.match(r.proposal.lines[0]!.name, /milk|maito/i);
    assert.deepEqual(
      [...new Set((r.selection.steps ?? []).map((s) => s.step))],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      "every step of the recipe story is recorded",
    );
  });

  it("other organizations don't see this recipe", async () => {
    const other = await newOrg("rec2");
    expectStatus(await other.buyer.get(`/api/recipes/${recipeId}`), 404, "another organization reads the recipe");
  });

  it("stock-out alerts are available", async () => {
    expectStatus(await org.buyer.get("/api/intelligence/stockout-alerts"), 200, "stock-out alerts");
  });
});
