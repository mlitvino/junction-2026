import "server-only";
import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { searchProductsTool } from "./tools/search-products";

const GEMINI_MODEL = "google/gemini-3.8-flash";

// Gemini when GOOGLE_GENERATIVE_AI_API_KEY is set (Mastra reads it itself). Without a key
// (CI, builds, frontend dev) the agent falls back to a mock that always gives the same answer.
const useGemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

const mockModel = createMockModel({
  mockText: "[mock] I found 1 matching product. No order was placed.",
  version: "v2",
});

export const purchasingAgent = new Agent({
  id: "purchasing-agent",
  name: useGemini ? "Purchasing agent" : "Purchasing agent (mock)",
  instructions:
    "You help a professional kitchen find products and place orders within its spending limit. " +
    "Use search-products to look up the catalog.",
  model: useGemini ? GEMINI_MODEL : mockModel,
  tools: { searchProducts: searchProductsTool },
});
