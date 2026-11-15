// Product codes from Valio Aimo's supplied catalog. Names and sales units are fetched from the API.
export const RESTOCK_SCENARIO = [
  { productId: "464306", productType: "Milk", current: 2, threshold: 4, target: 12 },
  { productId: "463828", productType: "Cream", current: 2, threshold: 4, target: 12 },
  { productId: "462421", productType: "Butter", current: 8, threshold: 4, target: 12 },
  { productId: "464798", productType: "Cheese", current: 4, threshold: 2, target: 6 },
] as const;

export const RESTOCK_SCENARIO_PROMPT = "Check low stock and restock to target";
