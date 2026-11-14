import "server-only";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it, mock } from "node:test";
import { RequestContext } from "@mastra/core/request-context";

import { app } from "@/server/api/app";
import { extractorAgent } from "@/server/agents/extractor-agent";
import { orderChangeAgent } from "@/server/agents/order-change-agent";
import { purchasingAgent } from "@/server/agents/purchasing-agent";
import { checkRecurringAnomaliesTool } from "@/server/agents/tools/procurement-intelligence";
import {
  createOrderFromRecipeTool,
  listRecipesTool,
} from "@/server/agents/tools/recipes-and-inventory";
import {
  DEFAULT_AGENT_GUARDRAILS,
  DEFAULT_MOCK_PREFERENCES,
  evaluateOrderGuardrails,
} from "@/server/services/guardrails";
import { canonicalizeJson } from "@/server/services/intelligence";
import { MOCK_CATALOG_PRODUCTS } from "@/server/services/mock-catalog";
import {
  countLayeredPreferenceMatches,
  evaluateCustomerPreferences,
} from "@/server/services/orders";
import { DEFAULT_PREFERENCES, resolvePreferences } from "@/server/services/preferences";
import type { ExtractedProductItem } from "@/shared/contracts/extract";
import type { SessionUser } from "@/shared/contracts/me";
import type { Preferences } from "@/shared/contracts/preferences";

async function jsonReq<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

async function withGeminiEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (value === undefined) {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  } else {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = value;
  }
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    } else {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = prev;
    }
    mock.restoreAll();
  }
}

function stubExtractorAgent(itemsByPrompt: Record<string, ExtractedProductItem[]>) {
  return mock.method(extractorAgent, "generate", async (prompt: string) => ({
    object: {
      items: itemsByPrompt[prompt] ?? [],
    },
  }));
}

describe("Trusted Trade Agents — Missing Core & Optional Backend Features", () => {
  it("exposes all new routes in OpenAPI 3.1 specification", async () => {
    const { status, body } = await jsonReq<{ paths: Record<string, unknown> }>("/api/openapi.json");
    assert.equal(status, 200);
    const expectedPaths = [
      "/api/inventory",
      "/api/inventory/items",
      "/api/inventory/items/{itemId}",
      "/api/recipes",
      "/api/recipes/{recipeId}",
      "/api/orders/from-recipe",
      "/api/orders/{orderId}/verify",
      "/api/catalog/substitutions",
      "/api/intelligence/stockout-alerts",
      "/api/intelligence/recurring-check",
      "/api/intelligence/recommendations",
    ];
    for (const p of expectedPaths) {
      assert.ok(p in body.paths, `Expected OpenAPI path ${p} to be documented`);
    }
  });

  it("manages kitchen inventory with unit normalization, clamping, and validation", async () => {
    const initial = await jsonReq<{ items: Array<{ id: string; ingredientName: string }> }>(
      "/api/inventory",
    );
    assert.equal(initial.status, 200);
    assert.ok(initial.body.items.length >= 6);

    // Upsert with grams -> normalized to KG
    const upserted = await jsonReq<{
      id: string;
      quantityInStock: number;
      unit: string;
    }>("/api/inventory/items", {
      method: "POST",
      body: JSON.stringify({
        ingredientName: "Test Herb Mix",
        productType: "Herbs",
        quantityInStock: 750,
        unit: "g",
        minParLevel: 1,
      }),
    });
    assert.equal(upserted.status, 200);
    assert.equal(upserted.body.quantityInStock, 0.75);
    assert.equal(upserted.body.unit, "KG");

    // Negative delta clamps at 0
    const clamped = await jsonReq<{ quantityInStock: number }>(
      `/api/inventory/items/${upserted.body.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quantityDelta: -10 }),
      },
    );
    assert.equal(clamped.status, 200);
    assert.equal(clamped.body.quantityInStock, 0);

    // Unknown item returns 404
    const missing = await jsonReq<{ error: string }>("/api/inventory/items/inv-does-not-exist", {
      method: "PATCH",
      body: JSON.stringify({ quantityDelta: 1 }),
    });
    assert.equal(missing.status, 404);

    // Invalid negative stock returns 400
    const badReq = await jsonReq<{ error: unknown }>("/api/inventory/items", {
      method: "POST",
      body: JSON.stringify({
        ingredientName: "Invalid",
        productType: "Milk",
        quantityInStock: -5,
        unit: "L",
      }),
    });
    assert.equal(badReq.status, 400);
  });

  it("lists Salmon Soup in recipe book and supports custom recipe creation", async () => {
    const search = await jsonReq<{ recipes: Array<{ id: string; name: string }> }>(
      "/api/recipes?q=salmon+soup",
    );
    assert.equal(search.status, 200);
    assert.equal(search.body.recipes.length, 1);
    assert.equal(search.body.recipes[0]?.id, "recipe-salmon-soup");

    const missing = await jsonReq<{ error: string }>("/api/recipes/recipe-unknown");
    assert.equal(missing.status, 404);

    const created = await jsonReq<{ id: string; source: string }>("/api/recipes", {
      method: "POST",
      body: JSON.stringify({
        name: "Custom Canteen Cheese Toast",
        baseServings: 10,
        ingredients: [
          { productName: "Creamy cheese", productType: "Cheese", quantity: 1.2, unit: "KG" },
        ],
        tags: ["snack"],
      }),
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.source, "customer");
  });

  it("executes User Story 2: Salmon Soup recipe-to-order with aggregation, inventory subtraction, preferences, swap, approval, and checkout", async () => {
    // 30 servings = 3x base (10 servings)
    const res = await jsonReq<{
      scaleFactor: number;
      ingredientReconciliation: Array<{
        productName: string;
        aggregatedBaseQuantity: number;
        totalNeededQuantity: number;
        inventoryStockQuantity: number;
        actuallyNeededQuantity: number;
        coveredByInventory: boolean;
      }>;
      pipeline: Array<{
        extractedItem: { productName: string };
        removedByPreferences: Array<{ id: string }>;
        selectedProduct: { id: string } | null;
      }>;
      order: {
        orderId: string;
        status: string;
        totalPriceEur: number;
        lines: Array<{ productId: string; quantity: number }>;
        auditTrail: Array<{ eventType: string }>;
      };
    }>("/api/orders/from-recipe", {
      method: "POST",
      body: JSON.stringify({
        recipeId: "recipe-salmon-soup",
        servings: 30,
        requireApproval: true,
      }),
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.scaleFactor, 3);

    const byName = new Map(res.body.ingredientReconciliation.map((r) => [r.productName, r]));

    // Duplicate butter lines (150g + 50g = 0.2kg base -> 0.6kg needed; 0.8kg in stock -> 0 needed!)
    const butter = byName.get("Unsalted butter");
    assert.ok(butter);
    assert.equal(butter.aggregatedBaseQuantity, 0.2);
    assert.equal(butter.totalNeededQuantity, 0.6);
    assert.equal(butter.inventoryStockQuantity, 0.8);
    assert.equal(butter.actuallyNeededQuantity, 0);
    assert.equal(butter.coveredByInventory, true);

    // Sliced leek: 0.4 * 3 = 1.2kg needed; 3.0kg in stock -> 0 needed!
    const leek = byName.get("Sliced leek");
    assert.ok(leek);
    assert.equal(leek.actuallyNeededQuantity, 0);
    assert.equal(leek.coveredByInventory, true);

    // Cooking cream: 1.0 * 3 = 3.0L needed; 2.5L in stock -> 0.5L needed!
    const cream = byName.get("Cooking cream");
    assert.ok(cream);
    assert.equal(cream.actuallyNeededQuantity, 0.5);

    // Diced potatoes: 2.5 * 3 = 7.5kg needed; 5.0kg in stock -> 2.5kg needed!
    const potatoes = byName.get("Diced potatoes");
    assert.ok(potatoes);
    assert.equal(potatoes.actuallyNeededQuantity, 2.5);

    // Under default vegetarian school-canteen preferences, real fish (460601, 460602) was filtered out and veggie salmon-style 460603 was selected
    const salmonTrace = res.body.pipeline.find(
      (p) => p.extractedItem.productName === "Salmon fillet",
    );
    assert.ok(salmonTrace);
    assert.ok(salmonTrace.removedByPreferences.some((r) => r.id === "460601"));
    assert.equal(salmonTrace.selectedProduct?.id, "460603");

    // Audit trail contains recipe_loaded and inventory_reconciled
    assert.ok(res.body.order.auditTrail.some((e) => e.eventType === "recipe_loaded"));
    assert.ok(res.body.order.auditTrail.some((e) => e.eventType === "inventory_reconciled"));
    assert.equal(res.body.order.status, "pending_approval");

    const orderId = res.body.order.orderId;

    // Step 10a: Swap product 460701 -> 460702 (Organic potatoes)
    const modified = await jsonReq<{ order: { lines: Array<{ productId: string }> } }>(
      `/api/orders/${orderId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          replacements: [{ fromProductId: "460701", toProductId: "460702" }],
        }),
      },
    );
    assert.equal(modified.status, 200);
    assert.ok(modified.body.order.lines.some((l) => l.productId === "460702"));

    // Step 10b: Human approval
    const approved = await jsonReq<{ order: { status: string } }>(
      `/api/orders/${orderId}/approval`,
      {
        method: "POST",
        body: JSON.stringify({
          decision: "approve",
          approverName: "Head Chef Laura",
          comment: "Approved organic potato swap for Friday salmon soup.",
        }),
      },
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.order.status, "approved");

    // Step 11: Checkout and issue receipt
    const checkedOut = await jsonReq<{
      order: { status: string };
      receipt: { receiptId: string; supplierConfirmationId: string };
    }>(`/api/orders/${orderId}/checkout`, {
      method: "POST",
      body: JSON.stringify({
        customerReference: "LUNCH-SALMON-SOUP",
        replenishInventory: true,
      }),
    });
    assert.equal(checkedOut.status, 200);
    assert.equal(checkedOut.body.order.status, "checked_out");
    assert.match(checkedOut.body.receipt.receiptId, /^RCP-/);
  });

  it("selects real Nordic Salmon Fillet (460601) when dietary restrictions allow fish, and handles 100%-in-stock edge case", async () => {
    const pescatarian = await jsonReq<{
      order: { lines: Array<{ productId: string }> };
    }>("/api/orders/from-recipe", {
      method: "POST",
      body: JSON.stringify({
        dishQuery: "salmon soup",
        servings: 10,
        inventoryOverride: [],
        previousOrders: [],
        preferences: {
          dietaryRestrictions: ["gluten-free"],
          excludedAllergens: ["peanuts", "soy"],
          nutrition: {},
        },
      }),
    });
    assert.equal(pescatarian.status, 200);
    assert.ok(pescatarian.body.order.lines.some((l) => l.productId === "460601"));

    // Edge case: 100% of recipe ingredients already covered by inventoryOverride
    const allCovered = await jsonReq<{
      extractedItems: unknown[];
      order: { status: string; totalPriceEur: number; lines: unknown[] };
    }>("/api/orders/from-recipe", {
      method: "POST",
      body: JSON.stringify({
        customRecipe: {
          name: "Small Leek Garnish",
          baseServings: 5,
          ingredients: [
            { productName: "Sliced leek", productType: "Vegetables", quantity: 200, unit: "G" },
          ],
        },
        inventoryOverride: [
          {
            ingredientName: "Sliced leek",
            productType: "Vegetables",
            quantityInStock: 2,
            unit: "KG",
          },
        ],
      }),
    });
    assert.equal(allCovered.status, 200);
    assert.equal(allCovered.body.extractedItems.length, 0);
    assert.equal(allCovered.body.order.lines.length, 0);
    assert.equal(allCovered.body.order.totalPriceEur, 0);
    assert.equal(allCovered.body.order.status, "confirmed");

    // Error paths: empty selector -> 400, unknown dish -> 404
    const emptyReq = await jsonReq("/api/orders/from-recipe", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(emptyReq.status, 400);

    const unknownDish = await jsonReq("/api/orders/from-recipe", {
      method: "POST",
      body: JSON.stringify({ dishQuery: "martian moon rocks" }),
    });
    assert.equal(unknownDish.status, 404);
  });

  it("evaluates allergen-safe Best/Better/Good substitutions, CO2 & delivery comparisons, and splits partial stock", async () => {
    const subs = await jsonReq<{
      excludedUnsafeAlternatives: Array<{ id: string }>;
      rankedSubstitutes: Array<{
        tier: string;
        allergenAndPreferenceSafe: boolean;
        candidate: { id: string };
      }>;
      partialAvailabilityPlan: {
        requiresSplitOrSubstitute: boolean;
        fullyFulfillableWithSubstitutes: boolean;
        totalFulfilledQuantity: number;
        allocations: Array<{ productId: string; allocatedQuantity: number }>;
      };
    }>("/api/catalog/substitutions", {
      method: "POST",
      body: JSON.stringify({
        productId: "460101",
        requestedQuantity: 800,
      }),
    });

    assert.equal(subs.status, 200);
    // Walnut cheese (460104), animal-rennet (460105), and high-salt/fat (460106) must be excluded
    const excludedIds = new Set(subs.body.excludedUnsafeAlternatives.map((e) => e.id));
    assert.ok(excludedIds.has("460104"));
    assert.ok(excludedIds.has("460105"));
    assert.ok(excludedIds.has("460106"));

    assert.ok(subs.body.rankedSubstitutes.length >= 2);
    assert.equal(subs.body.rankedSubstitutes[0]?.tier, "best");
    assert.ok(subs.body.rankedSubstitutes.every((s) => s.allergenAndPreferenceSafe));

    // 460101 has 650 KG -> 150 KG covered by best allergen-safe substitute
    assert.equal(subs.body.partialAvailabilityPlan.requiresSplitOrSubstitute, true);
    assert.equal(subs.body.partialAvailabilityPlan.fullyFulfillableWithSubstitutes, true);
    assert.equal(subs.body.partialAvailabilityPlan.totalFulfilledQuantity, 800);
    assert.equal(subs.body.partialAvailabilityPlan.allocations.length, 2);

    // Direct order creation with autoResolvePartialStock: true (parsed via Gemini extractorAgent)
    const splitOrder = await withGeminiEnv("test-gemini-key", async () => {
      stubExtractorAgent({
        "I want 800 kg of creamy cheese": [
          { productName: "Creamy cheese", productType: "Cheese", productQuantity: "800 kg" },
        ],
      });
      return jsonReq<{
        order: {
          lines: Array<{ productId: string; quantity: number }>;
          auditTrail: Array<{ eventType: string }>;
        };
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          prompt: "I want 800 kg of creamy cheese",
          autoResolvePartialStock: true,
          budgetEur: 6000,
        }),
      });
    });
    assert.equal(splitOrder.status, 200);
    assert.equal(splitOrder.body.order.lines.length, 2);
    assert.ok(splitOrder.body.order.auditTrail.some((e) => e.eventType === "partial_stock_split"));
  });

  it("verifies cryptographic SHA-256 trust claims, proactive stock-out alerts, recurring anomalies, recommendations, and agent orchestration", async () => {
    // Create a clean order via Gemini extractorAgent and verify its SHA-256 claims
    const created = await withGeminiEnv("test-gemini-key", async () => {
      stubExtractorAgent({
        "I want 50 kg of creamy cheese": [
          { productName: "Creamy cheese", productType: "Cheese", productQuantity: "50 kg" },
        ],
      });
      return jsonReq<{ order: { orderId: string } }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want 50 kg of creamy cheese" }),
      });
    });
    assert.equal(created.status, 200);
    const orderId = created.body.order.orderId;

    const verify = await jsonReq<{
      allClaimsVerified: boolean;
      verificationMethod: string;
      claims: Array<{ evidenceData: Record<string, unknown>; sha256Digest: string }>;
    }>(`/api/orders/${orderId}/verify`);
    assert.equal(verify.status, 200);
    assert.equal(verify.body.verificationMethod, "canonical-json-sha256-v1");
    assert.equal(verify.body.allClaimsVerified, true);

    // Recompute SHA-256 independently to prove open verification
    const firstClaim = verify.body.claims[0]!;
    const recomputed = createHash("sha256")
      .update(canonicalizeJson(firstClaim.evidenceData), "utf8")
      .digest("hex");
    assert.equal(recomputed, firstClaim.sha256Digest);

    // Proactive supplier stock-out alerts (460502 has 0 stock)
    const alerts = await jsonReq<{
      alerts: Array<{
        affectedProductId: string | null;
        triggerType: string;
        recommendedReplacements: unknown[];
      }>;
    }>("/api/intelligence/stockout-alerts");
    assert.equal(alerts.status, 200);
    const supplierAlert = alerts.body.alerts.find((a) => a.affectedProductId === "460502");
    assert.ok(supplierAlert);
    assert.equal(supplierAlert.triggerType, "supplier_out_of_stock");
    assert.ok(supplierAlert.recommendedReplacements.length > 0);

    // Recurring-order anomaly check
    const spike = await jsonReq<{
      safeToAutoRepeat: boolean;
      anomalies: Array<{ anomalyType: string }>;
    }>("/api/intelligence/recurring-check", {
      method: "POST",
      body: JSON.stringify({
        items: [{ productId: "460101", quantity: 600 }],
      }),
    });
    assert.equal(spike.status, 200);
    assert.equal(spike.body.safeToAutoRepeat, false);
    assert.ok(spike.body.anomalies.some((a) => a.anomalyType === "quantity_spike"));

    const emptyAnomaly = await jsonReq("/api/intelligence/recurring-check", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(emptyAnomaly.status, 400);

    // Proactive supplier recommendations
    const recs = await jsonReq<{
      recommendations: Array<{ product: { id: string }; recommendationType: string }>;
    }>("/api/intelligence/recommendations");
    assert.equal(recs.status, 200);
    assert.ok(recs.body.recommendations.some((r) => r.product.id === "461001"));
    assert.ok(recs.body.recommendations.some((r) => r.product.id === "460503"));

    // Autonomous Gemini agent run for Salmon Soup recipe
    const agentRes = await withGeminiEnv("test-gemini-key", async () => {
      mock.method(
        purchasingAgent,
        "generate",
        async (_msg: string, options?: { requestContext?: RequestContext }) => {
          assert.ok(createOrderFromRecipeTool.execute);
          await createOrderFromRecipeTool.execute(
            { recipeId: "recipe-salmon-soup", servings: 20 },
            { requestContext: options?.requestContext },
          );
          return {
            text: "Prepared salmon soup order for 20 servings.",
            toolCalls: [
              {
                toolName: "createOrderFromRecipe",
                args: { recipeId: "recipe-salmon-soup", servings: 20 },
              },
            ],
          };
        },
      );
      return jsonReq<{
        mode: string;
        toolCalls: Array<{ toolName: string }>;
        activeOrder: { orderId: string } | null;
      }>("/api/agent/run", {
        method: "POST",
        body: JSON.stringify({
          message: "Order ingredients for salmon soup for 20 servings",
        }),
      });
    });
    assert.equal(agentRes.status, 200);
    assert.equal(agentRes.body.mode, "gemini");
    assert.ok(agentRes.body.toolCalls.some((t) => t.toolName === "createOrderFromRecipe"));
    assert.ok(agentRes.body.activeOrder?.orderId);
  });

  it("enforces 3-layer organization preferences across evaluation, ranking, and substitute guardrails", async () => {
    const baseProduct = MOCK_CATALOG_PRODUCTS[0]!;
    const layered: Preferences = {
      ...DEFAULT_PREFERENCES,
      maxCo2PerKg: 2.5,
      minDeliveryReliability: 0.95,
      preferredOriginCountries: ["FI"],
      excludedAllergens: ["CRUSTACEANS", "FISH"],
      preferredVendors: ["Valio Oy"],
      blockedVendors: ["Blocked Supplier Oy"],
      preferredBrands: ["Valio"],
      allowSubstitutes: false,
    };

    const compliantCandidate = {
      ...baseProduct,
      name: "Valio Whole Milk 1L",
      brand: "Valio",
      vendorName: "Valio Oy",
      countryOfOrigin: "FI",
      co2PerKg: 1.1,
      deliveryReliability: 0.985,
      allergens: ["milk"],
      dietaryTags: ["gluten-free", "vegetarian"],
      category: "Dairy",
      isOrganic: false,
    };
    assert.deepEqual(
      evaluateCustomerPreferences(compliantCandidate, DEFAULT_MOCK_PREFERENCES, layered),
      [],
    );
    assert.deepEqual(countLayeredPreferenceMatches(compliantCandidate, layered), {
      originMatch: true,
      vendorMatch: true,
      brandMatch: true,
      matchCount: 3,
    });

    const violatingCandidate = {
      ...baseProduct,
      name: "Tiger Shrimp 1kg",
      brand: "Other",
      vendorName: "Blocked Supplier Oy",
      countryOfOrigin: "TH",
      co2PerKg: 6.4,
      deliveryReliability: 0.89,
      allergens: ["crustaceans"],
      dietaryTags: [],
      category: "Seafood",
      isOrganic: false,
    };
    const violations = evaluateCustomerPreferences(
      violatingCandidate,
      DEFAULT_MOCK_PREFERENCES,
      layered,
    );
    assert.ok(violations.some((v) => v.includes("CO2 footprint")));
    assert.ok(violations.some((v) => v.includes("Delivery reliability")));
    assert.ok(violations.some((v) => v.includes("is blocked by organization preferences")));
    assert.ok(violations.some((v) => v.includes("crustaceans")));
    assert.equal(countLayeredPreferenceMatches(violatingCandidate, layered).matchCount, 0);

    // allowSubstitutes=false with usedSubstitutes=true must trigger human approval
    const sampleOrder = await withGeminiEnv("test-gemini-key", async () => {
      stubExtractorAgent({
        "I want 5 kg of creamy cheese": [
          { productName: "Creamy cheese", productType: "Cheese", productQuantity: "5 kg" },
        ],
      });
      return jsonReq<{
        order: {
          lines: Parameters<typeof evaluateOrderGuardrails>[0]["lines"];
          totalPriceEur: number;
        };
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          prompt: "I want 5 kg of creamy cheese",
          requireApproval: false,
        }),
      });
    });
    assert.equal(sampleOrder.status, 200);

    const subEval = evaluateOrderGuardrails({
      lines: sampleOrder.body.order.lines,
      totalPriceEur: sampleOrder.body.order.totalPriceEur,
      guardrails: {
        ...DEFAULT_AGENT_GUARDRAILS,
        requireCustomerConfirmation: false,
        autoApproveLimitEur: 500,
      },
      allowSubstitutes: false,
      usedSubstitutes: true,
    });
    assert.equal(subEval.requiresHumanApproval, true);
    assert.equal(subEval.authorizedForAutoConfirm, false);
    assert.ok(
      subEval.violations.some((v) =>
        v.message.includes("Organization preferences disallow automatic substitutes"),
      ),
    );

    // Verify layered lock & null-override resolution
    const resolvedBuyer = resolvePreferences(
      "buyer",
      {
        values: {
          maxCo2PerKg: 2.0,
          excludedAllergens: ["NUTS"],
        },
        locked: ["maxCo2PerKg", "excludedAllergens"],
        updatedAt: null,
      },
      {
        values: {
          maxCo2PerKg: 10.0, // ignored because locked in base
          excludedAllergens: [], // ignored because locked in base
          maxOrderValue: null, // explicitly unlimited in buyer layer
        },
        locked: [],
        updatedAt: null,
      },
    );
    assert.equal(resolvedBuyer.values.maxCo2PerKg, 2.0);
    assert.deepEqual(resolvedBuyer.values.excludedAllergens, ["NUTS"]);
    assert.equal(resolvedBuyer.values.maxOrderValue, null);
  });

  it("requires Gemini for prompt extraction, agent routing, and order-change prompts, and forwards RequestContext actor", async () => {
    const orderRes = await withGeminiEnv("test-gemini-key", async () => {
      stubExtractorAgent({
        "I want 5 kg of creamy cheese": [
          { productName: "Creamy cheese", productType: "Cheese", productQuantity: "5 kg" },
        ],
      });
      return jsonReq<{
        order: { orderId: string };
      }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          prompt: "I want 5 kg of creamy cheese",
          requireApproval: false,
        }),
      });
    });
    assert.equal(orderRes.status, 200);
    const orderId = orderRes.body.order.orderId;

    // Missing GOOGLE_GENERATIVE_AI_API_KEY fails loudly instead of falling back to deterministic parsing
    await withGeminiEnv(undefined, async () => {
      const extractErr = await jsonReq<{ error: string }>("/api/extract", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to cook 100 salmon soups" }),
      });
      assert.equal(extractErr.status, 500);
      assert.match(extractErr.body.error, /GOOGLE_GENERATIVE_AI_API_KEY is not set/);

      const orderErr = await jsonReq<{ error: string }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want 5 kg of creamy cheese" }),
      });
      assert.equal(orderErr.status, 500);
      assert.match(orderErr.body.error, /GOOGLE_GENERATIVE_AI_API_KEY is not set/);

      const agentErr = await jsonReq<{ error: string }>("/api/agent/run", {
        method: "POST",
        body: JSON.stringify({ message: "I want to cook 100 salmon soups" }),
      });
      assert.equal(agentErr.status, 500);
      assert.match(agentErr.body.error, /GOOGLE_GENERATIVE_AI_API_KEY is not set/);

      const patchErr = await jsonReq<{ error: string }>(`/api/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ prompt: "Swap 460101 for 460301" }),
      });
      assert.equal(patchErr.status, 500);
      assert.match(patchErr.body.error, /GOOGLE_GENERATIVE_AI_API_KEY is not set/);
    });

    // Gemini-backed agent routing + order-change prompt parsing
    const agentAnomalyRes = await withGeminiEnv("test-gemini-key", async () => {
      mock.method(
        purchasingAgent,
        "generate",
        async (_msg: string, options?: { requestContext?: RequestContext }) => {
          assert.ok(checkRecurringAnomaliesTool.execute);
          await checkRecurringAnomaliesTool.execute(
            { orderId },
            { requestContext: options?.requestContext },
          );
          return {
            text: `Recurring-order anomaly check completed for ${orderId}.`,
            toolCalls: [{ toolName: "checkRecurringAnomalies", args: { orderId } }],
          };
        },
      );
      return jsonReq<{
        mode: string;
        reply: string;
        toolCalls: Array<{ toolName: string }>;
      }>("/api/agent/run", {
        method: "POST",
        body: JSON.stringify({
          message: `Check order ${orderId} for recurring anomalies against historical baseline`,
          orderId,
        }),
      });
    });
    assert.equal(agentAnomalyRes.status, 200);
    assert.equal(agentAnomalyRes.body.mode, "gemini");
    assert.ok(agentAnomalyRes.body.toolCalls.some((t) => t.toolName === "checkRecurringAnomalies"));
    assert.match(agentAnomalyRes.body.reply, /Recurring-order anomaly check/);

    const modifiedViaGemini = await withGeminiEnv("test-gemini-key", async () => {
      mock.method(orderChangeAgent, "generate", async () => ({
        object: {
          replacements: [{ fromTarget: "460101", toTarget: "460301" }],
          quantityUpdates: [],
          removeTargets: [],
        },
      }));
      return jsonReq<{ order: { lines: Array<{ productId: string }> } }>(`/api/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ prompt: "Swap 460101 for 460301" }),
      });
    });
    assert.equal(modifiedViaGemini.status, 200);
    assert.ok(modifiedViaGemini.body.order.lines.some((l) => l.productId === "460301"));

    // Invoke Mastra tools directly with a RequestContext containing actor
    const mockActor: SessionUser = {
      id: "user-test-1",
      username: "buyer_test",
      organization: { id: "org-test-1", name: "Test Kitchen Oy" },
      roles: ["buyer"],
    };
    const requestContext = new RequestContext();
    requestContext.set("actor", mockActor);

    assert.ok(listRecipesTool.execute);
    const recipesOut = await listRecipesTool.execute({}, { requestContext });
    assert.ok(recipesOut && typeof recipesOut === "object" && "recipes" in recipesOut);
    assert.ok(Array.isArray(recipesOut.recipes));
    assert.ok(recipesOut.recipes.length > 0);

    assert.ok(checkRecurringAnomaliesTool.execute);
    const anomalyOut = await checkRecurringAnomaliesTool.execute({ orderId }, { requestContext });
    assert.ok(anomalyOut && typeof anomalyOut === "object" && "safeToAutoRepeat" in anomalyOut);
    assert.equal(typeof anomalyOut.safeToAutoRepeat, "boolean");
    assert.ok(Array.isArray(anomalyOut.anomalies));
  });
});
