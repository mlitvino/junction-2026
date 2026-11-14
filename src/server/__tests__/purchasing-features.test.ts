import "server-only";

// Run: pnpm test:server. No database: covers the API surface (default-deny, OpenAPI paths) and the
// pure parts of product selection, allergens, inventory reconciliation and verification. The
// stateful flow (proposal → approval → order) is covered by the rule tests in
// server/purchasing/rules.test.ts and server/policy/evaluate.test.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { app } from "@/server/api/app";
import { AgentError, callModel, GEMINI_MODEL, isAgentTestMode, requireGeminiApiKey, resolveAgentModel } from "@/server/agents/mode";
import { runPurchasingAgent } from "@/server/services/agent";
import { extractProductsFromPrompt } from "@/server/services/extract";
import { canonicalizeJson, sha256Canonical } from "@/server/services/intelligence";
import { normalizeQuantityAndUnit, reconcileRecipeIngredientsWithInventory } from "@/server/services/inventory";
import {
  isSyntheticId,
  MOCK_CATALOG_PRODUCTS,
  normalizeAllergenList,
} from "@/server/services/mock-catalog";
import {
  computeNameMatchScore,
  evaluateCustomerPreferences,
  parseQuantityAndUnit,
} from "@/server/services/selection";
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
