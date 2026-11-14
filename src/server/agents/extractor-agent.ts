import "server-only";

import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";

const GEMINI_MODEL = "google/gemini-3.8-flash";

// Gemini when GOOGLE_GENERATIVE_AI_API_KEY is set (Mastra reads it itself). Without a key
// (CI, builds, frontend dev) the agent falls back to a deterministic mock response.
const useGemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

const mockModel = createMockModel({
  mockText: {
    items: [
      {
        productName: "Creamy cheese",
        productType: "Cheese",
        productQuantity: "420 kg",
      },
    ],
  },
  version: "v2",
});

export const extractorAgent = new Agent({
  id: "extractor-agent",
  name: useGemini ? "Prompt extractor" : "Prompt extractor (mock)",
  instructions:
    "You extract structured product order items from free-form user prompts regardless of phrasing or language. " +
    "For each requested product, extract: " +
    "1) productName: the full descriptive product name as requested (capitalize the first letter, e.g. 'Creamy cheese'), " +
    "2) productType: the general product category/type inferred from the product (e.g. 'Cheese', 'Milk', 'Butter'), " +
    "3) productQuantity: the requested numeric amount and unit together (e.g. '420 kg', '50 L', or 'unspecified' if omitted). " +
    "If no products are requested, return an empty items array.",
  model: useGemini ? GEMINI_MODEL : mockModel,
});
