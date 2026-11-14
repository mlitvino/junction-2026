import "server-only";

import { Agent } from "@mastra/core/agent";

import { GEMINI_MODEL } from "./gemini";

export const extractorAgent = new Agent({
  id: "extractor-agent",
  name: "Prompt extractor",
  instructions:
    "You parse every free-form user prompt (regardless of phrasing or language) into structured JSON of product items: " +
    "productName, productType, and productQuantity. " +
    "For each requested product (or required ingredient when the user describes a dish/meal to cook, e.g. 'cook 100 salmon soups'): " +
    "1) productName: the descriptive product name (capitalize the first letter, e.g. 'Creamy cheese', 'Salmon fillet'), " +
    "2) productType: the general product category/type inferred from the product (e.g. 'Cheese', 'Fish', 'Potato', 'Cream', 'Butter', 'Vegetables', 'Herbs', 'Milk', 'Yogurt'), " +
    "3) productQuantity: the requested numeric amount and unit together (e.g. '420 kg', '50 L', or 'unspecified' if omitted). " +
    "If no products or dishes are requested, return an empty items array.",
  model: GEMINI_MODEL,
});
