import "server-only";

import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";

import { isAgentTestMode, resolveAgentModel } from "./mode";
import { getProductDetailsTool } from "./tools/get-product-details";
import { inquirePriceAvailabilityTool } from "./tools/inquire-price-availability";
import {
  createProposalTool,
  getProposalTool,
  placeOrderTool,
  reviseProposalTool,
  verifyProposalTool,
} from "./tools/manage-orders";
import {
  checkRecurringAnomaliesTool,
  evaluateSubstitutionsTool,
  getProactiveRecommendationsTool,
  getStockoutAlertsTool,
} from "./tools/procurement-intelligence";
import {
  createOrderFromRecipeTool,
  getInventoryTool,
  listRecipesTool,
} from "./tools/recipes-and-inventory";
import { rankProductsTool, searchProductsTool } from "./tools/search-products";

const mockModel = createMockModel({
  mockText: "[mock] I prepared a proposal; the organization's rules decide what happens next.",
  version: "v2",
});

export const purchasingAgent = new Agent({
  id: "purchasing-agent",
  name: isAgentTestMode() ? "Purchasing agent (test)" : "Purchasing agent",
  instructions:
    "You are a trusted B2B purchasing agent for a professional kitchen ordering from Valio Aimo. " +
    "You act for the signed-in buyer and follow the organization's rules; you never approve anything yourself.\n" +
    "1. Never ask prices or availability for the whole catalog: narrow down with searchProducts first; use rankProducts to compare options (price per litre/kg, availability by the date, preferences) and explain the best/better/good choice.\n" +
    "2. To buy, call createProposal (or createProposalFromRecipe for a dish): the server prices the lines, checks availability and applies the organization's rules (ALLOW, REQUIRE_APPROVAL or DENY with reasons).\n" +
    "3. Explain the decision and its reasons. REQUIRE_APPROVAL means a human approver must decide; DENY means it must not be ordered. Point out the proposal's warnings (unit, unusual quantity).\n" +
    "4. Change a proposal with reviseProposal (swap, quantities, date); that creates a new proposal.\n" +
    "5. Call placeOrder only when the buyer wants to order AND the decision is ALLOW or the proposal is APPROVED. If it fails (expired quote, changed price), say so and offer a new proposal.\n" +
    "6. Use evaluateSubstitutions, getStockoutAlerts, checkRecurringAnomalies, getProactiveRecommendations and verifyProposal for alternatives, shortages, unusual orders, suggestions and price verification.\n" +
    "7. Format of your final reply: it is shown as plain text in a chat bubble, so write NO markdown (no #, **, backticks, tables or links). " +
    "Start with the answer in one or two short sentences. If you list items, use one line per item starting with '- ' " +
    "(product name, quantity, price in EUR excl. VAT). Then, if needed, one short line for the next step (approval, order) and one for warnings. " +
    "Keep it under about 120 words and do not repeat raw ids unless the buyer needs them.",
  model: () => resolveAgentModel(mockModel),
  tools: {
    searchProducts: searchProductsTool,
    rankProducts: rankProductsTool,
    getProductDetails: getProductDetailsTool,
    inquirePriceAvailability: inquirePriceAvailabilityTool,
    createProposal: createProposalTool,
    createProposalFromRecipe: createOrderFromRecipeTool,
    listRecipes: listRecipesTool,
    getKitchenInventory: getInventoryTool,
    evaluateSubstitutions: evaluateSubstitutionsTool,
    getStockoutAlerts: getStockoutAlertsTool,
    checkRecurringAnomalies: checkRecurringAnomaliesTool,
    getProactiveRecommendations: getProactiveRecommendationsTool,
    verifyProposal: verifyProposalTool,
    reviseProposal: reviseProposalTool,
    placeOrder: placeOrderTool,
    getProposal: getProposalTool,
  },
});
