import "server-only";

import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";

import { getProductDetailsTool } from "./tools/get-product-details";
import { inquirePriceAvailabilityTool } from "./tools/inquire-price-availability";
import {
  checkoutOrderTool,
  createProcurementOrderTool,
  getOrderDetailsTool,
  modifyOrderTool,
} from "./tools/manage-orders";
import {
  checkRecurringAnomaliesTool,
  evaluateSubstitutionsTool,
  getProactiveRecommendationsTool,
  getStockoutAlertsTool,
  verifyOrderTrustTool,
} from "./tools/procurement-intelligence";
import {
  createOrderFromRecipeTool,
  getInventoryTool,
  listRecipesTool,
} from "./tools/recipes-and-inventory";
import { searchProductsTool } from "./tools/search-products";

const GEMINI_MODEL = "google/gemini-3.8-flash";

// Gemini when GOOGLE_GENERATIVE_AI_API_KEY is set (Mastra reads it itself). Without a key
// (CI, builds, frontend dev) the agent falls back to a mock model.
const useGemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

const mockModel = createMockModel({
  mockText: "[mock] I found matching products and validated guardrails.",
  version: "v2",
});

export const purchasingAgent = new Agent({
  id: "purchasing-agent",
  name: useGemini ? "Purchasing agent" : "Purchasing agent (mock)",
  instructions:
    "You are a trusted B2B purchasing agent for professional kitchens ordering from Valio Aimo. " +
    "Follow these procurement rules strictly:\n" +
    "1. Never query prices/availability for the entire catalog — always narrow down products first with searchProducts or getProductDetails.\n" +
    "2. Before committing to any order, confirm fixed prices and stock availability via inquirePriceAvailability or createProcurementOrder.\n" +
    "3. Respect customer dietary restrictions, excluded allergens, nutritional thresholds, and agent spending/category guardrails.\n" +
    "4. If an order violates guardrails or exceeds autonomous spending authority, leave it in 'pending_approval' and clearly explain why human approval is required.\n" +
    "5. Support customer order changes (e.g. swapping product X for product Y or adjusting quantities) via modifyOrder.\n" +
    "6. When a buyer wants ingredients for a dish or recipe (such as salmon soup / lohikeitto), use listRecipes or createOrderFromRecipe so existing kitchen inventory stock is automatically subtracted.\n" +
    "7. Use evaluateSubstitutions, getStockoutAlerts, checkRecurringAnomalies, getProactiveRecommendations, and verifyOrderTrust when evaluating allergen-safe alternatives, shortages, anomalies, or SHA-256 verification proofs.\n" +
    "8. Only call checkoutOrder when the order is authorized ('confirmed' or 'approved') and the customer wants to finalize it; always summarize the receipt and confirmation ID.",
  model: useGemini ? GEMINI_MODEL : mockModel,
  tools: {
    searchProducts: searchProductsTool,
    getProductDetails: getProductDetailsTool,
    inquirePriceAvailability: inquirePriceAvailabilityTool,
    createProcurementOrder: createProcurementOrderTool,
    createOrderFromRecipe: createOrderFromRecipeTool,
    listRecipes: listRecipesTool,
    getKitchenInventory: getInventoryTool,
    evaluateSubstitutions: evaluateSubstitutionsTool,
    getStockoutAlerts: getStockoutAlertsTool,
    checkRecurringAnomalies: checkRecurringAnomaliesTool,
    getProactiveRecommendations: getProactiveRecommendationsTool,
    verifyOrderTrust: verifyOrderTrustTool,
    modifyOrder: modifyOrderTool,
    checkoutOrder: checkoutOrderTool,
    getOrderDetails: getOrderDetailsTool,
  },
});
