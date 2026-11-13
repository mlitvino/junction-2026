import "server-only";
import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { searchProductsTool } from "./tools/search-products";

// MOCK agent: the model always answers with the same text, so no API key or network is needed.
// To use a real LLM later, replace `model` with a "provider/model" string
// (e.g. "anthropic/claude-sonnet-5-5") and set that provider's API key in .env.local.
export const purchasingAgent = new Agent({
  id: "purchasing-agent",
  name: "Purchasing agent (mock)",
  instructions:
    "You help a professional kitchen find products and place orders within its spending limit. " +
    "Use search-products to look up the catalog.",
  model: createMockModel({
    mockText: "[mock] I found 1 matching product. No order was placed.",
    version: "v2",
  }),
  tools: { searchProducts: searchProductsTool },
});
