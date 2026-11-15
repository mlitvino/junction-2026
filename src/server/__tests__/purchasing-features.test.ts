import "server-only";

// Run: pnpm test:server. No database: covers the API surface (default-deny, OpenAPI paths) and the
// pure parts of product selection, allergens, inventory reconciliation and verification. The
// stateful flow (proposal → approval → order) is covered by the rule tests in
// server/purchasing/rules.test.ts and server/policy/evaluate.test.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { app } from "@/server/api/app";
import { AgentError, callModel, GEMINI_MODEL, isAgentTestMode, requireGeminiApiKey, resolveAgentModel } from "@/server/agents/mode";
import { parseOrderChangeDeterministically } from "@/server/agents/order-change-agent";
import { evaluatePolicy } from "@/server/policy/evaluate";
import { runPurchasingAgent } from "@/server/services/agent";
import { extractProductsFromPrompt } from "@/server/services/extract";
import { canonicalizeJson, sha256Canonical } from "@/server/services/intelligence";
import { DEFAULT_MOCK_INVENTORY, normalizeQuantityAndUnit, reconcileRecipeIngredientsWithInventory } from "@/server/services/inventory";
import { DEFAULT_VALIO_RECIPES } from "@/server/services/recipes";
import {
  isSyntheticId,
  MOCK_CATALOG_PRODUCTS,
  normalizeAllergenList,
} from "@/server/services/mock-catalog";
import {
  computeNameMatchScore,
  computeReplacementQuantity,
  narrowBeforePricing,
  evaluateBuyerPreferences,
  evaluateCustomerPreferences,
  filterRelevantCandidates,
  filterSyntheticCatalogProducts,
  isNonFoodProduct,
  mergeProposalLines,
  parseQuantityAndUnit,
  planCandidateSearchTerms,
  selectRelevantCandidates,
  updateSelectionForRevision,
  wordStems,
} from "@/server/services/selection";
import { DEFAULT_PREFERENCES } from "@/server/services/preferences";
import type { ProposalSelection } from "@/shared/contracts/purchasing";
import type { CandidateProduct } from "@/shared/contracts/selection";
import { allergenCodes, allergenNames, containsExcludedAllergen } from "@/shared/contracts/allergens";

const get = (path: string) => app.request(path);

describe("API surface", () => {
  it("documents the unified purchasing routes and none of the retired ones", async () => {
    const res = await get("/api/openapi.json");
    assert.equal(res.status, 200);
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, { tags?: string[] }>>;
      tags?: { name: string }[];
    };
    const paths = Object.keys(spec.paths);
    // Tag order drives Swagger UI: Agents first, and every used tag is listed.
    const listed = (spec.tags ?? []).map((t) => t.name);
    assert.equal(listed[0], "Agents");
    const used = new Set(Object.values(spec.paths).flatMap((ops) => Object.values(ops).flatMap((op) => op.tags ?? [])));
    for (const tag of used) assert.ok(listed.includes(tag), `tag not listed in app.ts: ${tag}`);
    for (const p of [
      "/api/proposals",
      "/api/proposals/from-prompt",
      "/api/proposals/from-recipe",
      "/api/proposals/{id}/revise",
      "/api/proposals/{id}/approval",
      "/api/proposals/{id}/order",
      "/api/proposals/{id}/audit",
      "/api/proposals/{id}/verify",
      "/api/approvals/{id}/decision",
      "/api/approvals/pending-count",
      "/api/trust/public-key",
      "/api/orders/{id}/receipt",
      "/api/audit",
      "/api/policy/evaluate",
      "/api/products/rank",
      "/api/products/{id}/substitutes",
      "/api/intelligence/recurring-check",
      "/api/agent/run",
    ])
      assert.ok(paths.includes(p), `missing ${p}`);
    for (const p of [
      "/api/guardrails",
      "/api/catalog/products",
      "/api/catalog/products/{productId}",
      "/api/catalog/substitutions",
      "/api/orders/from-recipe",
      "/api/orders/{orderId}/approval",
      "/api/orders/{orderId}/checkout",
      "/api/orders/{orderId}/verify",
    ])
      assert.ok(!paths.includes(p), `retired path still documented: ${p}`);
  });

  it("denies every private route without a session (default-deny)", async () => {
    for (const path of [
      "/api/me",
      "/api/proposals",
      "/api/orders",
      "/api/approvals",
      "/api/approvals/pending-count",
      "/api/audit",
      "/api/products?q=milk",
      "/api/inventory",
      "/api/recipes",
      "/api/intelligence/recommendations",
      "/api/preferences/effective",
    ]) {
      const res = await get(path);
      assert.equal(res.status, 401, `${path} answered ${res.status}`);
    }
    for (const [path, body] of [
      ["/api/proposals/x/approval", {}],
      ["/api/approvals/x/decision", { decision: "APPROVED", proposalHash: "h" }],
      ["/api/agent/run", { message: "buy milk" }],
    ] as const) {
      const res = await app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      assert.equal(res.status, 401, `POST ${path} answered ${res.status}`);
    }
  });

  it("keeps health, the docs and the signing public key public", async () => {
    assert.equal((await get("/api/openapi.json")).status, 200);
    assert.notEqual((await get("/api/health")).status, 401);
    const key = await get("/api/trust/public-key");
    assert.equal(key.status, 200);
    const body = (await key.json()) as { algorithm: string; keyId: string; publicKeyPem: string };
    assert.equal(body.algorithm, "Ed25519");
    assert.match(body.keyId, /^[0-9a-f]{16}$/);
    assert.match(body.publicKeyPem, /BEGIN PUBLIC KEY/);
  });
});

describe("Allergens", () => {
  it("treats names and GS1 codes as the same thing", () => {
    assert.deepEqual([...allergenCodes(["milk"])].sort(), ["AM", "ML"]);
    assert.ok(allergenCodes(["gluten"]).has("UW"));
    assert.ok(allergenCodes(["am"]).has("AM"));
    assert.deepEqual(allergenNames(["AM", "ML", "AY"]).sort(), ["milk", "soy"]);
    assert.equal(containsExcludedAllergen(["ML"], ["milk"]), true);
    assert.equal(containsExcludedAllergen(["AY"], ["milk", "AW"]), false);
    assert.deepEqual(normalizeAllergenList(["AM", "SA"]).sort(), ["milk", "tree-nuts"]);
  });
});

describe("Synthetic catalog", () => {
  it("never reuses real Valio codes", () => {
    assert.ok(MOCK_CATALOG_PRODUCTS.length > 0);
    for (const p of MOCK_CATALOG_PRODUCTS) {
      assert.ok(isSyntheticId(p.id), `${p.id} looks like a real product code`);
      for (const sub of p.substituteIds) assert.ok(isSyntheticId(sub));
    }
  });
});

describe("Product selection", () => {
  it("parses requested quantities", () => {
    const kg = parseQuantityAndUnit("420 kg");
    assert.equal(kg.quantity, 420);
    assert.equal(kg.unit.toUpperCase(), "KG");
    assert.equal(parseQuantityAndUnit("50 L").unit.toUpperCase(), "L");
    assert.deepEqual(parseQuantityAndUnit("some"), { quantity: 1, unit: "KG" });
  });

  it("scores name matches", () => {
    assert.ok(computeNameMatchScore("lactose-free milk", "Arla lactose free milk drink 1 L") > computeNameMatchScore("lactose-free milk", "Fennel"));
  });

  it("filters candidates by the organization's dietary and allergen rules", () => {
    const rules = { dietaryRestrictions: ["lactose-free"], excludedAllergens: ["soy"], nutrition: {} };
    const ok = { dietaryTags: ["lactose-free", "vegetarian"], allergens: ["milk"], nutrition: null };
    const soy = { dietaryTags: ["lactose-free"], allergens: ["soy"], nutrition: null };
    const notLactoseFree = { dietaryTags: ["vegetarian"], allergens: [], nutrition: null };
    assert.deepEqual(evaluateCustomerPreferences(ok, rules), []);
    assert.equal(evaluateCustomerPreferences(soy, rules).length, 1);
    assert.equal(evaluateCustomerPreferences(notLactoseFree, rules).length, 1);
  });

  it("never excludes a product for missing nutrition data", () => {
    const rules = { dietaryRestrictions: [], excludedAllergens: [], nutrition: { maxSaltPer100g: 0.1 } };
    assert.deepEqual(evaluateCustomerPreferences({ dietaryTags: [], allergens: [], nutrition: null }, rules), []);
  });
});

describe("Recipes and inventory", () => {
  it("normalizes units and subtracts kitchen stock", () => {
    assert.deepEqual(normalizeQuantityAndUnit(750, "g"), { quantity: 0.75, unit: "KG" });
    const reconciliation = reconcileRecipeIngredientsWithInventory({
      ingredients: [
        { productName: "Salmon fillet", productType: "Fish", quantity: 1, unit: "kg" },
        { productName: "Salmon fillet", productType: "Fish", quantity: 500, unit: "g" },
      ],
      scaleFactor: 2,
      inventory: [
        {
          id: "inv-1",
          organizationId: "org",
          ingredientName: "Salmon fillet",
          productType: "Fish",
          linkedProductId: null,
          quantityInStock: 1,
          unit: "KG",
          minParLevel: null,
          location: null,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    assert.equal(reconciliation.length, 1);
    assert.equal(reconciliation[0]!.totalNeededQuantity, 3);
    assert.equal(reconciliation[0]!.actuallyNeededQuantity, 2);
  });

  it("reconciles salmon soup recipe against mock inventory with duplicate butter aggregation", () => {
    const salmonSoup = DEFAULT_VALIO_RECIPES.find((r) => r.id === "recipe-salmon-soup")!;
    assert.ok(salmonSoup);
    const inventory = DEFAULT_MOCK_INVENTORY.map((i) => ({ ...i, organizationId: "org" }));
    const rec = reconcileRecipeIngredientsWithInventory({
      ingredients: salmonSoup.ingredients,
      scaleFactor: 1,
      inventory,
    });
    const byName = new Map(rec.map((r) => [r.productName, r]));
    assert.equal(byName.get("Unsalted butter")?.totalNeededQuantity, 0.2);
    assert.equal(byName.get("Unsalted butter")?.coveredByInventory, true);
    assert.equal(byName.get("Salmon fillet")?.actuallyNeededQuantity, 1.8);
    assert.equal(byName.get("Fresh dill")?.actuallyNeededQuantity, 0.05);
  });
});

describe("Deterministic extraction", () => {
  it("parses dash format, cases, and dl units when TEST_MODE=TRUE", async () => {
    const prev = process.env.TEST_MODE;
    process.env.TEST_MODE = "TRUE";
    try {
      const dash = await extractProductsFromPrompt({ prompt: "Creamy cheese - Cheese - 440 kg" });
      assert.deepEqual(dash.items, [
        { productName: "Creamy cheese", productType: "Cheese", productQuantity: "440 kg" },
      ]);
      const cases = await extractProductsFromPrompt({ prompt: "Buy 50 cases of Valio milk and 100 dl cream" });
      assert.equal(cases.items.length, 2);
      assert.equal(cases.items[0]!.productQuantity, "50 cases");
      assert.equal(cases.items[0]!.productType, "Milk");
      assert.equal(cases.items[1]!.productQuantity, "100 dl");
      assert.equal(cases.items[1]!.productType, "Cream");
    } finally {
      if (prev === undefined) delete process.env.TEST_MODE;
      else process.env.TEST_MODE = prev;
    }
  });
});

describe("Verification", () => {
  it("hashes canonical JSON independent of key order", () => {
    assert.equal(canonicalizeJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalizeJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
    const expected = createHash("sha256").update(canonicalizeJson({ a: 1 })).digest("hex");
    assert.equal(sha256Canonical({ a: 1 }), expected);
  });
});

describe("Agent mode gating", () => {
  async function withEnv(
    patch: Record<string, string | undefined>,
    fn: () => Promise<void> | void,
  ): Promise<void> {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(patch)) {
      prev[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("uses deterministic/mock mode only when TEST_MODE=TRUE and requires Gemini key otherwise", async () => {
    const mockModel = { id: "mock-model" } as unknown as Parameters<typeof resolveAgentModel>[0];

    await withEnv({ TEST_MODE: undefined, GOOGLE_GENERATIVE_AI_API_KEY: undefined }, () => {
      assert.equal(isAgentTestMode(), false);
      assert.throws(() => requireGeminiApiKey(), /GOOGLE_GENERATIVE_AI_API_KEY/);
      assert.throws(() => resolveAgentModel(mockModel), /GOOGLE_GENERATIVE_AI_API_KEY/);
      assert.throws(
        () => requireGeminiApiKey(),
        (err) => err instanceof AgentError && err.status === 503 && err.code === "AGENT_NOT_CONFIGURED",
      );
    });

    await withEnv({ TEST_MODE: "false", GOOGLE_GENERATIVE_AI_API_KEY: undefined }, () => {
      assert.equal(isAgentTestMode(), false);
      assert.throws(() => requireGeminiApiKey(), /GOOGLE_GENERATIVE_AI_API_KEY/);
    });

    await withEnv({ TEST_MODE: "TRUE", GOOGLE_GENERATIVE_AI_API_KEY: "test-key" }, () => {
      assert.equal(isAgentTestMode(), true);
      requireGeminiApiKey();
      assert.equal(resolveAgentModel(mockModel), mockModel);
    });

    await withEnv({ TEST_MODE: undefined, GOOGLE_GENERATIVE_AI_API_KEY: "test-key" }, () => {
      assert.equal(isAgentTestMode(), false);
      requireGeminiApiKey();
      assert.equal(resolveAgentModel(mockModel), GEMINI_MODEL);
    });
  });

  it("turns model failures into 502 MODEL_FAILED and keeps errors with their own meaning", async () => {
    assert.equal(await callModel(async () => 42), 42);
    await assert.rejects(
      () => callModel(async () => Promise.reject(new Error("upstream 500 from the model provider"))),
      (err) =>
        err instanceof AgentError && err.status === 502 && err.code === "MODEL_FAILED" && !err.message.includes("upstream"),
    );
    const own = new AgentError(503, "AGENT_NOT_CONFIGURED", "no key");
    await assert.rejects(() => callModel(async () => Promise.reject(own)), (err) => err === own);
    class ToolError extends Error {}
    const tool = new ToolError("not the creator");
    await assert.rejects(() => callModel(async () => Promise.reject(tool), (e) => e instanceof ToolError), (err) => err === tool);
  });

  it("gates extractProductsFromPrompt and runPurchasingAgent behind TEST_MODE=TRUE or Gemini key", async () => {
    await withEnv({ TEST_MODE: undefined, GOOGLE_GENERATIVE_AI_API_KEY: undefined }, async () => {
      await assert.rejects(
        () => extractProductsFromPrompt({ prompt: "10 kg of creamy cheese" }),
        /GOOGLE_GENERATIVE_AI_API_KEY/,
      );
      await assert.rejects(
        () =>
          runPurchasingAgent(
            { message: "Search milk" },
            {
              id: "user-1",
              username: "buyer",
              organization: { id: "org-1", name: "Org" },
              roles: ["buyer"],
            },
          ),
        /GOOGLE_GENERATIVE_AI_API_KEY/,
      );
    });

    await withEnv({ TEST_MODE: "TRUE", GOOGLE_GENERATIVE_AI_API_KEY: undefined }, async () => {
      const res = await extractProductsFromPrompt({ prompt: "10 kg of creamy cheese" });
      assert.equal(res.items.length, 1);
      assert.equal(res.items[0]!.productType, "Cheese");
    });
  });
});

describe("Selection relevance, stemming, and modifier handling", () => {
  it("singularizes English plurals without corrupting stems", () => {
    assert.deepEqual(wordStems("potatoes"), ["potatoes", "potato"]);
    assert.deepEqual(wordStems("cheeses"), ["cheeses", "cheese"]);
    assert.deepEqual(wordStems("berries"), ["berries", "berry"]);
    assert.deepEqual(wordStems("dishes"), ["dishes", "dish"]);
    assert.deepEqual(wordStems("dill"), ["dill"]);
    assert.deepEqual(wordStems("glass"), ["glass"]);
  });

  it("blocks single-letter prefix credit and unrelated generic-modifier matches", () => {
    assert.equal(computeNameMatchScore("cilantro", "Vitamin +C"), 0);
    assert.equal(computeNameMatchScore("lobster", "Beer 0,33 l"), 0);

    const scoreList = (requestedName: string, names: string[]) =>
      filterRelevantCandidates(
        names.map((name, i) => ({ id: `P${i}`, name, nameMatchScore: computeNameMatchScore(requestedName, name) })),
      ).map((c) => c.name);

    // Real failure scenarios: must return 0 relevant candidates instead of forcing unrelated items.
    assert.deepEqual(scoreList("Fresh cilantro", ["Jenkki Strawberry +C", "Jenkki Fresh Xylitol", "Fresh dill 100g"]), []);
    assert.deepEqual(scoreList("Fresh lobster", ["Alcohol-free beer 0,33 l", "Fresh salmon fillet 1 kg"]), []);
    assert.deepEqual(scoreList("Fresh wild Alaskan halibut", ["Fresh salmon salad", "Salmon fillet 1 kg"]), []);

    // Salmon soup recipe ingredients still match cleanly.
    const potatoMatches = scoreList("Diced potatoes", ["Potato 5 kg", "Diced potato 2 kg", "Jenkki Fresh"]);
    assert.ok(potatoMatches.includes("Diced potato 2 kg"));
    assert.ok(potatoMatches.includes("Potato 5 kg"));
    assert.ok(!potatoMatches.includes("Jenkki Fresh"));

    // Varieties named with their class noun, products with a longer name, and verb forms still match.
    for (const [requested, name] of [
      ["Cheddar", "Valio Cheddar cheese 1kg"],
      ["Emmental", "Valio Emmental cheese slices 1 kg"],
      ["rapeseed", "Rapeseed oil 1 L"],
      ["lactose-free milk", "Arla lactose free milk drink 1 L"],
      ["skim milk", "Valio skimmed milk 1 L"],
      ["whipping cream", "Valio whipped cream 2 dl"],
    ] as const)
      assert.ok(computeNameMatchScore(requested, name) >= 0.35, `${requested} → ${name}: ${computeNameMatchScore(requested, name)}`);
    // …while different products stay below the floor.
    for (const [requested, name] of [
      ["potato", "Potato salad 1 kg"],
      ["butter", "Cocoa butter 1 kg"],
      ["salmon fillet", "Smoked salmon fillet 1 kg"],
      ["milk", "Milk chocolate 100 g"],
      ["Cheddar", "Cheddar crisps 100 g"],
      ["cream", "Valio cream cheese 200 g"],
      ["oat", "Oatmeal 1 kg"],
    ] as const)
      assert.ok(computeNameMatchScore(requested, name) < 0.35, `${requested} → ${name}: ${computeNameMatchScore(requested, name)}`);

    assert.deepEqual(scoreList("Fresh dill", ["Dill 100 g", "Fresh parsley 100 g"]), ["Dill 100 g"]);
    assert.deepEqual(scoreList("Fresh dill", ["Dill 100 g", "Fresh dill 50 g", "Fresh parsley 100 g"]), ["Fresh dill 50 g"]);
  });
});

describe("Narrowing candidates before live price lookups", () => {
  const row = (id: string, name: string) => ({ id, name, category: "0101", vatCode: "FOOD" });

  it("prices only products whose names can match, best first, at most 40", () => {
    const rows = [row("1", "Valio milk 1 L"), row("2", "Milk chocolate 100 g"), row("3", "Valio lactose free milk 1 L"), row("4", "Fennel")];
    assert.deepEqual(narrowBeforePricing(rows, "lactose-free milk").map((r) => r.id)[0], "3");
    assert.ok(!narrowBeforePricing(rows, "lactose-free milk").some((r) => r.id === "4"));
    assert.deepEqual(narrowBeforePricing(rows, "unicorn milk"), [], "nothing matches: nothing is priced");

    const many = Array.from({ length: 200 }, (_, i) => row(String(i), `Valio milk ${i} L`));
    assert.equal(narrowBeforePricing(many, "milk").length, 40);
    assert.equal(narrowBeforePricing(many).length, 40, "without a name: the first 40 in SQL order");
  });
});

describe("Deterministic extraction edge cases", () => {
  it("preserves decimal commas and hyphenated product names", async () => {
    const prev = process.env.TEST_MODE;
    process.env.TEST_MODE = "TRUE";
    try {
      const decimalButter = await extractProductsFromPrompt({ prompt: "Buy 2,5 kg of butter" });
      assert.deepEqual(decimalButter.items, [
        { productName: "Butter", productType: "Butter", productQuantity: "2.5 kg" },
      ]);

      const dashDecimal = await extractProductsFromPrompt({ prompt: "Creamy cheese - Cheese - 2,5 kg" });
      assert.deepEqual(dashDecimal.items, [
        { productName: "Creamy cheese", productType: "Cheese", productQuantity: "2.5 kg" },
      ]);

      const hyphenated = await extractProductsFromPrompt({ prompt: "Lactose-free milk - Milk - 100 L" });
      assert.deepEqual(hyphenated.items, [
        { productName: "Lactose-free milk", productType: "Milk", productQuantity: "100 L" },
      ]);
    } finally {
      if (prev === undefined) delete process.env.TEST_MODE;
      else process.env.TEST_MODE = prev;
    }
  });
});

describe("Shared buyer preferences and proposal revision helpers", () => {
  const makeCandidate = (id: string, name: string, overrides: Partial<CandidateProduct> = {}): CandidateProduct => ({
    id,
    name,
    productType: "Milk",
    category: "MILK",
    brand: "Valio",
    vendorName: "VALIO OY",
    salesUnit: "ST",
    unitPriceEur: 1.5,
    availableQuantity: 100,
    deliveryReliability: 0.98,
    co2PerKg: 1.2,
    dietaryTags: ["lactose-free"],
    allergens: ["milk"],
    nutrition: null,
    nameMatchScore: 0.9,
    previouslyOrderedProduct: false,
    previouslyOrderedBrand: false,
    ...overrides,
  });

  it("evaluates dietary, allergen (names and GS1 codes), vendor, CO2, and reliability rules uniformly", () => {
    const rules = {
      dietaryRestrictions: ["lactose-free"],
      excludedAllergens: ["AM", "soy"],
      blockedVendors: ["BLOCKED CO"],
      maxCo2PerKg: 3.0,
      minDeliveryReliability: 0.9,
    };
    assert.deepEqual(
      evaluateBuyerPreferences(
        { dietaryTags: ["lactose-free"], allergens: [], vendorName: "VALIO OY", co2PerKg: 1.5, deliveryReliability: 0.95 },
        rules,
      ),
      [],
    );
    const bad = evaluateBuyerPreferences(
      { dietaryTags: [], allergens: ["milk", "AY"], vendorName: "BLOCKED CO", co2PerKg: 4.5, deliveryReliability: 0.8 },
      rules,
    );
    assert.equal(bad.length, 6);
    assert.ok(bad.some((r) => r.includes("lactose-free")));
    assert.ok(bad.some((r) => r.includes("milk")));
    assert.ok(bad.some((r) => r.includes("soy")));
    assert.ok(bad.some((r) => r.includes("BLOCKED CO")));
    assert.ok(bad.some((r) => r.includes("CO2")));
    assert.ok(bad.some((r) => r.includes("reliability")));
  });

  it("recomputes replacement quantity across pack sizes and falls back with warning when content is unknown", () => {
    const oldFacts = {
      salesUnit: "KI",
      baseUnit: "ST",
      units: [{ unitId: "KI", sizeInBaseUnits: 20 }],
      contentPerBaseUnit: 1,
      contentUnit: "L",
    };
    const newFacts = {
      salesUnit: "ST",
      baseUnit: "ST",
      units: [],
      contentPerBaseUnit: 1,
      contentUnit: "L",
    };
    const converted = computeReplacementQuantity({
      oldQuantity: 5,
      oldUnit: "KI",
      oldName: "Milk 20L case",
      newName: "Milk 1L carton",
      newSalesUnit: "ST",
      trace: { parsedQuantity: 100, parsedUnit: "L" },
      oldFacts,
      newFacts,
    });
    assert.equal(converted.quantity, 100);
    assert.equal(converted.warning, null);

    const noContent = computeReplacementQuantity({
      oldQuantity: 5,
      oldUnit: "KI",
      oldName: "Milk 20L case",
      newName: "Mystery Milk",
      newSalesUnit: "ST",
      trace: { parsedQuantity: 100, parsedUnit: "L" },
      oldFacts,
      newFacts: { salesUnit: "ST", baseUnit: "ST", units: [], contentPerBaseUnit: null, contentUnit: null },
    });
    assert.equal(noContent.quantity, 5);
    assert.ok(noContent.warning && noContent.warning.includes("Check the quantity"));

    // The buyer changed 5 cases (100 L) to 2 cases (40 L): the swap follows the 40 L, not the
    // original 100 L request.
    const afterEdit = computeReplacementQuantity({
      oldQuantity: 2,
      oldUnit: "KI",
      oldName: "Milk 20L case",
      newName: "Milk 1L carton",
      newSalesUnit: "ST",
      trace: { parsedQuantity: 100, parsedUnit: "L", orderedQuantity: 2 },
      oldFacts,
      newFacts,
    });
    assert.equal(afterEdit.quantity, 40);
  });

  it("updates selection pipeline, suggestedAlternatives, and warnings on swap/update/remove/add", () => {
    const prodA = makeCandidate("A", "Milk A");
    const prodB = makeCandidate("B", "Milk B");
    const prodC = makeCandidate("C", "Butter C", { productType: "Butter", salesUnit: "KG" });
    const oldSelection: ProposalSelection = {
      prompt: "Buy 100 L milk",
      extractedItems: [{ productName: "Milk", productType: "Milk", productQuantity: "100 L" }],
      pipeline: [
        {
          extractedItem: { productName: "Milk", productType: "Milk", productQuantity: "100 L" },
          parsedQuantity: 100,
          parsedUnit: "L",
          orderedQuantity: 5,
          conversionNote: "100 L → 5 KI",
          matchedByTypeCount: 2,
          removedByPreferences: [],
          sortedCandidates: [prodA, prodB],
          selectedProduct: prodA,
        },
      ],
      suggestedAlternatives: [{ forProductId: "A", forProductName: "Milk A", alternatives: [prodB] }],
      previousOrdersUsed: [],
      warnings: [],
    };

    const afterSwap = updateSelectionForRevision({
      oldSelection,
      newLines: [{ productId: "B", quantity: 100 }],
      replacements: [{ fromProductId: "A", toProduct: prodB, quantity: 100, conversionNote: "100 L → 100 ST" }],
      quantityUpdates: [],
      removedProductIds: [],
      addedItems: [],
      appliedChanges: ["Replaced Milk A (A) with Milk B (B), 100 ST."],
    })!;

    assert.equal(afterSwap.pipeline[0]!.selectedProduct?.id, "B");
    assert.equal(afterSwap.pipeline[0]!.orderedQuantity, 100);
    assert.equal(afterSwap.suggestedAlternatives[0]!.forProductId, "B");
    assert.deepEqual(
      afterSwap.suggestedAlternatives[0]!.alternatives.map((a) => a.id),
      ["A"],
    );
    assert.ok(afterSwap.warnings.some((w) => w.includes("Revised by user:")));

    const afterAddAndRemove = updateSelectionForRevision({
      oldSelection: afterSwap,
      newLines: [{ productId: "C", quantity: 3 }],
      replacements: [],
      quantityUpdates: [],
      removedProductIds: ["B"],
      addedItems: [{ product: prodC, quantity: 3 }],
      appliedChanges: ["Removed Milk B (B).", "Added 3 KG of Butter C (C)."],
    })!;

    assert.equal(afterAddAndRemove.pipeline.length, 1);
    assert.equal(afterAddAndRemove.pipeline[0]!.selectedProduct?.id, "C");
    assert.equal(afterAddAndRemove.pipeline[0]!.orderedQuantity, 3);
    assert.equal(afterAddAndRemove.suggestedAlternatives[0]!.forProductId, "C");
  });
});

describe("B1: catalog candidate query planning & real-fixture name scoring", () => {
  it("plans core-word primary queries without generic modifiers and non-category OR fallback", () => {
    const potatoPlan = planCandidateSearchTerms("Vegetables", "Diced potatoes");
    assert.deepEqual(potatoPlan.coreWords, ["potatoes"]);
    assert.deepEqual(potatoPlan.primaryTermGroups, [["potatoes", "potato"]]);
    assert.deepEqual(potatoPlan.fallbackOrStems, []);

    const dillPlan = planCandidateSearchTerms("Herbs", "Fresh dill");
    assert.deepEqual(dillPlan.coreWords, ["dill"]);
    assert.deepEqual(dillPlan.primaryTermGroups, [["dill"]]);
    assert.deepEqual(dillPlan.fallbackOrStems, []);

    const cloudberryPlan = planCandidateSearchTerms("Yogurt", "Lapland cloudberry quark");
    assert.deepEqual(cloudberryPlan.coreWords, ["lapland", "cloudberry", "quark"]);
    assert.deepEqual(cloudberryPlan.primaryTermGroups, [["lapland"], ["cloudberry"], ["quark"]]);
    assert.deepEqual(cloudberryPlan.fallbackOrStems, ["lapland", "cloudberry", "quark"]);
  });

  it("ranks plain real-catalog potatoes and dill above sweet/derived/compound products", () => {
    const scoreAndFilter = (requestedName: string, names: string[]) =>
      filterRelevantCandidates(
        names
          .map((name, i) => ({
            id: `P${i}`,
            name,
            nameMatchScore: computeNameMatchScore(requestedName, name),
          }))
          .sort((a, b) => b.nameMatchScore - a.nameMatchScore),
      ).map((c) => c.name);

    const potatoCandidates = [
      "AVIKO 2,27KG SWEET DICED POTATO",
      "JEPO Cooked potato cubes 10mm 3kg",
      "POTATO WASHED 1KG",
      "SPL potato peeled 10kg",
      "Sweet potato 1 kg",
      "Rummo Potato Gnocchi 2kg",
      "POTATO PEELER",
      "SWEET POTATO PURPLE",
      "Forssan Potato Salad",
    ];
    const potatoKept = scoreAndFilter("Diced potatoes", potatoCandidates);
    assert.equal(potatoKept[0], "JEPO Cooked potato cubes 10mm 3kg");
    assert.ok(potatoKept.includes("POTATO WASHED 1KG"));
    assert.ok(potatoKept.includes("SPL potato peeled 10kg"));
    assert.ok(!potatoKept.includes("AVIKO 2,27KG SWEET DICED POTATO"));
    assert.ok(!potatoKept.includes("Sweet potato 1 kg"));
    assert.ok(!potatoKept.includes("Rummo Potato Gnocchi 2kg"));
    assert.ok(!potatoKept.includes("POTATO PEELER"));
    assert.ok(!potatoKept.includes("SWEET POTATO PURPLE"));
    assert.ok(!potatoKept.includes("Forssan Potato Salad"));

    const dillCandidates = [
      "DILL 100G",
      "TAMSIN 100G DILL BUNCH FINLAND",
      "Järvikylä min50g Dill",
      "6 x Boy dill herring",
    ];
    const dillKept = scoreAndFilter("Fresh dill", dillCandidates);
    assert.equal(dillKept[0], "DILL 100G");
    assert.ok(!dillKept.includes("6 x Boy dill herring"));
  });
});

describe("B2: deterministic order-change parsing with commas, decimals, and prepositions", () => {
  it("parses real product names without truncating at commas, decimal commas, or 'for'", () => {
    const knownLines = [
      { productId: "460001", name: "Salmon fillet, fresh", requestedName: "Salmon fillet" },
      {
        productId: "460002",
        name: "Arla Cooking cream 15% lactose free 10 L UHT",
        requestedName: "Cooking cream",
      },
      {
        productId: "460003",
        name: "Valio Eila® butter for laminating 4x5 kg unsalted lactose free",
        requestedName: "Butter",
      },
    ];

    const salmon = parseOrderChangeDeterministically(
      "Change Salmon fillet, fresh to Salmon fillet, frozen Nordic",
      knownLines,
    );
    assert.deepEqual(salmon.replacements, [
      {
        fromTarget: "Salmon fillet, fresh",
        toTarget: "Salmon fillet, frozen Nordic",
        quantity: undefined,
      },
    ]);

    const cream = parseOrderChangeDeterministically(
      "Change Arla Cooking cream 15% lactose free 10 L UHT to Valio Keittiön cooking cream 10 % 3,3 dl lactose free",
      knownLines,
    );
    assert.deepEqual(cream.replacements, [
      {
        fromTarget: "Arla Cooking cream 15% lactose free 10 L UHT",
        toTarget: "Valio Keittiön cooking cream 10 % 3,3 dl lactose free",
        quantity: undefined,
      },
    ]);

    const butter = parseOrderChangeDeterministically(
      "Change Valio Eila® butter for laminating 4x5 kg unsalted lactose free to Valio butter 500 g unsalted",
      knownLines,
    );
    assert.deepEqual(butter.replacements, [
      {
        fromTarget: "Valio Eila® butter for laminating 4x5 kg unsalted lactose free",
        toTarget: "Valio butter 500 g unsalted",
        quantity: undefined,
      },
    ]);

    // Also works without knownLines by preferring to/with/into over for/on and preserving commas/decimals.
    const withoutKnown = parseOrderChangeDeterministically(
      "Change Valio Eila® butter for laminating 4x5 kg unsalted lactose free to Valio butter 500 g unsalted",
    );
    assert.deepEqual(withoutKnown.replacements, butter.replacements);
  });

  it("understands quantities with any unit word, 'and set N cases' on swaps, and remove lists", () => {
    assert.deepEqual(parseOrderChangeDeterministically("set milk to 30 cases").quantityUpdates, [{ target: "milk", quantity: 30 }]);
    assert.deepEqual(parseOrderChangeDeterministically("change quantity of milk to 300 pcs").quantityUpdates, [
      { target: "milk", quantity: 300 },
    ]);
    assert.deepEqual(parseOrderChangeDeterministically("set butter to 2,5 kg").quantityUpdates, [{ target: "butter", quantity: 2.5 }]);
    assert.deepEqual(parseOrderChangeDeterministically("set 30 cases of milk").quantityUpdates, [{ target: "milk", quantity: 30 }]);
    // The contract's own example (ReviseProposalRequestSchema.prompt).
    assert.deepEqual(parseOrderChangeDeterministically("Change 469330 to 469386 and set 30 cases").replacements, [
      { fromTarget: "469330", toTarget: "469386", quantity: 30 },
    ]);
    assert.deepEqual(parseOrderChangeDeterministically("remove milk, butter").removeTargets, ["milk", "butter"]);
  });
});

describe("B3: merging duplicate productId lines on revision and policy evaluation", () => {
  it("merges A->B swap into existing B line and triggers maxLineQuantity cap", () => {
    const initialLines: Array<{
      productId: string;
      name: string;
      quantity: number;
      unit: string;
      substituteFor: { requested: string; reason: "split" | "swap" | "fallback" } | null;
    }> = [
      { productId: "A", name: "Product A", quantity: 8, unit: "ST", substituteFor: null },
      { productId: "B", name: "Product B", quantity: 6, unit: "ST", substituteFor: null },
    ];
    // Simulate swapping A -> B in place (as reviseProposalFromRequest does before merging)
    const afterSwap = [...initialLines];
    afterSwap[0] = {
      productId: "B",
      name: "Product B",
      quantity: 8,
      unit: "ST",
      substituteFor: { requested: "Product A", reason: "swap" as const },
    };

    const merged = mergeProposalLines(afterSwap);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.productId, "B");
    assert.equal(merged[0]!.quantity, 14);
    assert.deepEqual(merged[0]!.substituteFor, { requested: "Product A", reason: "swap" });

    const policy = evaluatePolicy(
      { ...DEFAULT_PREFERENCES, maxLineQuantity: 10 },
      merged.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        product: {
          vendorName: "VALIO OY",
          category: "100",
          allergens: [],
          mayContainAllergens: [],
          co2PerKg: 1,
          deliveryReliability: 0.99,
        },
        unitPriceExclVat: 2,
        salesUnit: "ST",
        substituteFor: l.substituteFor,
        availability: {
          salesBlock: false,
          orderable: true,
          availableDate: "2026-11-20",
          availableQuantity: 100,
          salesUnit: "ST",
        },
      })),
    );
    assert.equal(policy.outcome, "REQUIRE_APPROVAL");
    assert.ok(
      policy.reasons.some((r) => r.code === "LINE_QUANTITY_TOO_HIGH" && r.productId === "B"),
      "Expected LINE_QUANTITY_TOO_HIGH for merged line B of quantity 14",
    );
  });
});

describe("BE1(a): synthetic catalog fallback filter", () => {
  it("does not match everything when typeNorm is empty and matches by typeNorm or coreWords", () => {
    const emptyPlan = planCandidateSearchTerms("", "");
    assert.deepEqual(filterSyntheticCatalogProducts(MOCK_CATALOG_PRODUCTS, emptyPlan), []);

    const emptyTypePlan = planCandidateSearchTerms("", "salmon fillet");
    const byCoreWords = filterSyntheticCatalogProducts(MOCK_CATALOG_PRODUCTS, emptyTypePlan);
    assert.ok(byCoreWords.length > 0);
    assert.ok(byCoreWords.every((p) => p.name.toLowerCase().includes("salmon") && p.name.toLowerCase().includes("fillet")));

    const noMatchPlan = planCandidateSearchTerms("", "unicorn milk");
    assert.deepEqual(filterSyntheticCatalogProducts(MOCK_CATALOG_PRODUCTS, noMatchPlan), []);
  });
});

describe("BE2/BE3: real Valio catalog relevance regression (no DB)", () => {
  const productsPath = path.resolve(process.cwd(), "data/valio/products.json");
  const hasCatalog = existsSync(productsPath);

  it("picks food-appropriate plain/matching products for recipe-salmon-soup and standalone requests", { skip: hasCatalog ? false : "data/valio/products.json not present" }, () => {
    type RawItem = {
      id: string;
      deleted?: boolean;
      category: string;
      vendorName: string;
      synkkaData?: {
        brand?: string;
        vatCode?: string;
        names?: { language: string; value: string }[];
      };
    };
    const raw = (JSON.parse(readFileSync(productsPath, "utf8")) as RawItem[]).filter((p) => !p.deleted);
    const catalog = raw.map((p) => {
      const en = p.synkkaData?.names?.find((n) => n.language === "en")?.value;
      const fi = p.synkkaData?.names?.find((n) => n.language === "fi")?.value;
      const sv = p.synkkaData?.names?.find((n) => n.language === "sv")?.value;
      const name = en ?? fi ?? p.synkkaData?.names?.[0]?.value ?? p.id;
      const searchText = [en, fi, sv, p.synkkaData?.brand, p.vendorName, p.id].filter(Boolean).join(" ").toLowerCase();
      return { id: p.id, name, category: p.category, vatCode: p.synkkaData?.vatCode ?? null, searchText };
    });

    const trigrams = (s: string) => {
      const padded = `  ${s.toLowerCase().replace(/[^a-z0-9äöå]+/g, " ")} `;
      const set = new Set<string>();
      for (let i = 0; i <= padded.length - 3; i++) set.add(padded.slice(i, i + 3));
      return set;
    };
    const pgSim = (a: string, b: string) => {
      const ta = trigrams(a);
      const tb = trigrams(b);
      let inter = 0;
      for (const t of ta) if (tb.has(t)) inter++;
      const union = ta.size + tb.size - inter;
      return union ? inter / union : 0;
    };

    const runSelection = (productName: string, productType: string) => {
      const plan = planCandidateSearchTerms(productType, productName);
      let matched = catalog.filter((p) =>
        plan.primaryTermGroups.every((stems) => stems.some((s) => p.searchText.includes(s))),
      );
      if (matched.length === 0 && plan.fallbackOrStems.length > 0) {
        matched = catalog.filter((p) => plan.fallbackOrStems.some((s) => p.searchText.includes(s)));
      }
      const sqlWindow = [...matched]
        .sort((a, b) => {
          const scoreOf = (p: (typeof catalog)[number]) => {
            const food = !isNonFoodProduct(p.category, p.vatCode) ? 0.25 : 0;
            const mod = plan.modifierBoostTerms.some((t) => p.name.toLowerCase().includes(t)) ? 0.2 : 0;
            const typ = plan.typeNorm && p.searchText.includes(plan.typeNorm) ? 0.1 : 0;
            return food + mod + typ + pgSim(p.name, plan.scoringQuery);
          };
          return scoreOf(b) - scoreOf(a) || a.id.localeCompare(b.id);
        })
        .slice(0, 200);

      const scored = sqlWindow
        .map((p) => ({ ...p, nameMatchScore: computeNameMatchScore(productName, p.name) }))
        .sort((a, b) => b.nameMatchScore - a.nameMatchScore || a.name.localeCompare(b.name));
      return selectRelevantCandidates(scored);
    };

    // 1. All recipe-salmon-soup ingredients
    const salmonSoup = DEFAULT_VALIO_RECIPES.find((r) => r.id === "recipe-salmon-soup");
    assert.ok(salmonSoup);
    const seen = new Set<string>();
    for (const ing of salmonSoup.ingredients) {
      const key = `${ing.productName}|${ing.productType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const picked = runSelection(ing.productName, ing.productType);
      assert.ok(picked.length > 0, `Expected candidates for recipe ingredient '${ing.productName}'`);
      const topName = picked[0]!.name.toLowerCase();
      if (ing.productName === "Salmon fillet") {
        assert.ok(!topName.includes("smoked"), `Expected plain salmon fillet, got '${picked[0]!.name}'`);
      } else if (ing.productName === "Diced potatoes") {
        assert.ok(
          topName.includes("cube") || topName.includes("dice"),
          `Expected potato cubes/dices, got '${picked[0]!.name}'`,
        );
        assert.ok(!topName.includes("mashed") && !topName.includes("smashed"));
      } else if (ing.productName === "Fresh dill") {
        assert.ok(topName.includes("dill") && !topName.includes("herring"));
      } else if (ing.productName === "Unsalted butter") {
        assert.ok(topName.includes("unsalted") && topName.includes("butter"));
      }
    }

    // 2. Standalone requests
    const standalone: Array<{ q: string; type: string; bad: RegExp }> = [
      { q: "cream", type: "Cream", bad: /napkin|dunilin|scoop|ice cream|balsamic|potato/i },
      { q: "cheese", type: "Cheese", bad: /shaker|dipmix|pringles/i },
      { q: "butter", type: "Butter", bad: /spreader|butternutsquash|beans|brioche|cocoa|peanut/i },
      { q: "unsalted butter", type: "Butter", bad: /\bsalted\b|brioche|cocoa/i },
      { q: "milk", type: "Milk", bad: /\bjug\b|condensed|condensated|chocolate/i },
      { q: "lactose-free milk", type: "Milk", bad: /chocolate|sour milk/i },
      { q: "flour", type: "Flour", bad: /scoop/i },
      { q: "salmon", type: "Fish", bad: /slicer|saithe/i },
      { q: "eggs", type: "Eggs", bad: /chocolate|dumle/i },
    ];

    for (const req of standalone) {
      const picked = runSelection(req.q, req.type);
      assert.ok(picked.length > 0, `Expected candidates for '${req.q}'`);
      for (const c of picked.slice(0, 3)) {
        assert.ok(!req.bad.test(c.name), `Unexpected top-3 pick '${c.name}' for '${req.q}'`);
      }
    }

    // 3. No-match request: unicorn milk -> 0 candidates
    const unicorn = runSelection("unicorn milk", "Milk");
    assert.equal(unicorn.length, 0);
  });
});
