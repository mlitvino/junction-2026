import "server-only";

import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";

import { isAgentTestMode, resolveAgentModel } from "./mode";

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
  name: isAgentTestMode() ? "Prompt extractor (test)" : "Prompt extractor",
  instructions:
    "You extract structured product order items from free-form user prompts regardless of phrasing or language. " +
    "For each requested product, extract: " +
    "1) productName: the full descriptive product name as requested (capitalize the first letter, e.g. 'Creamy cheese'), " +
    "2) productType: the general product category/type inferred from the product (e.g. 'Cheese', 'Milk', 'Butter'), " +
    "3) productQuantity: the requested numeric amount and unit together (e.g. '420 kg', '50 L', or 'unspecified' if omitted). " +
    "If no products are requested, return an empty items array.",
  model: () => resolveAgentModel(mockModel),
});
