import "server-only";

import { Agent } from "@mastra/core/agent";

import { GEMINI_MODEL } from "./gemini";
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

export const purchasingAgent = new Agent({
  id: "purchasing-agent",
  name: "Purchasing agent",
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
  model: GEMINI_MODEL,
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
