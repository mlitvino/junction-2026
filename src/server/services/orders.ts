import "server-only";

import { randomUUID } from "node:crypto";

import { ensureCatalogSchema, type ProductRow } from "@/server/db/catalog-schema";
import { getPool } from "@/server/db/pool";
import { getPrices } from "@/server/services/catalog";
import { extractProductsFromPrompt } from "@/server/services/extract";
import type {
  BudgetComparison,
  CandidateProduct,
  CreatedOrder,
  CreateOrderFromPromptRequest,
  CreateOrderFromPromptResponse,
  CustomerPreferences,
  ItemProcurementTrace,
  NutritionProfile,
  OrderLineItem,
  PreviousOrderRecord,
  RemovedCandidate,
} from "@/shared/contracts/orders";

// ---------- Mock Customer Preferences, Previous Orders, Budget, and Catalog ----------

export const DEFAULT_MOCK_BUDGET_EUR = 2500;

export const DEFAULT_MOCK_PREFERENCES: CustomerPreferences = {
  dietaryRestrictions: ["vegetarian", "gluten-free"],
  excludedAllergens: ["peanuts", "tree-nuts", "soy", "crustaceans"],
  nutrition: {
    maxCaloriesPer100g: 420,
    maxFatPer100g: 36,
    maxSugarPer100g: 15,
    maxSaltPer100g: 2.2,
    minProteinPer100g: 3,
  },
};

export const DEFAULT_MOCK_PREVIOUS_ORDERS: PreviousOrderRecord[] = [
  {
    orderId: "ORD-HIST-001",
    orderedAt: "2026-10-25T09:30:00.000Z",
    productId: "460101",
    productName: "Valio Oltermanni Creamy Cheese 1kg",
    brand: "Valio",
    quantity: 120,
  },
  {
    orderId: "ORD-HIST-002",
    orderedAt: "2026-11-01T14:15:00.000Z",
    productId: "460201",
    productName: "Valio Fresh Whole Milk 1L",
    brand: "Valio",
    quantity: 80,
  },
  {
    orderId: "ORD-HIST-003",
    orderedAt: "2026-11-05T11:00:00.000Z",
    productId: "460301",
    productName: "Arla Creamy Havarti Cheese 1kg",
    brand: "Arla",
    quantity: 50,
  },
];

type RawCatalogCandidate = {
  id: string;
  name: string;
  productType: string;
  category: string;
  brand: string | null;
  vendorName: string;
  salesUnit: string;
  unitPriceEur: number;
  dietaryTags: string[];
  allergens: string[];
  nutrition: NutritionProfile;
};

const MOCK_CATALOG_PRODUCTS: RawCatalogCandidate[] = [
  // Cheese products (some pass preferences, some fail dietary/allergens/nutrition to demonstrate filtering)
  {
    id: "460101",
    name: "Valio Oltermanni Creamy Cheese 1kg",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "KG",
    unitPriceEur: 5.4,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 330,
      fatPer100g: 26,
      sugarPer100g: 0,
      saltPer100g: 1.4,
      proteinPer100g: 24,
    },
  },
  {
    id: "460102",
    name: "Valio Polar Creamy Cheese Mild 500g",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "KG",
    unitPriceEur: 5.8,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 285,
      fatPer100g: 19,
      sugarPer100g: 0,
      saltPer100g: 1.3,
      proteinPer100g: 28,
    },
  },
  {
    id: "460301",
    name: "Arla Creamy Havarti Cheese 1kg",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Arla",
    vendorName: "Arla Oy",
    salesUnit: "KG",
    unitPriceEur: 5.6,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 350,
      fatPer100g: 29,
      sugarPer100g: 0.2,
      saltPer100g: 1.6,
      proteinPer100g: 22,
    },
  },
  {
    id: "460104",
    name: "Artisan Walnut Creamy Cheese Spread",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Castello",
    vendorName: "Arla Oy",
    salesUnit: "KG",
    unitPriceEur: 7.2,
    dietaryTags: ["vegetarian", "gluten-free"],
    // Filtered out by excludedAllergens ("tree-nuts")
    allergens: ["milk", "tree-nuts"],
    nutrition: {
      caloriesPer100g: 375,
      fatPer100g: 33,
      sugarPer100g: 1.2,
      saltPer100g: 1.5,
      proteinPer100g: 16,
    },
  },
  {
    id: "460105",
    name: "Traditional Animal-Rennet Aged Creamy Cheese",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Kuusamon",
    vendorName: "Kuusamon Juusto Oy",
    salesUnit: "KG",
    unitPriceEur: 6.1,
    // Filtered out by dietaryRestrictions (missing "vegetarian")
    dietaryTags: ["gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 390,
      fatPer100g: 32,
      sugarPer100g: 0,
      saltPer100g: 1.8,
      proteinPer100g: 25,
    },
  },
  {
    id: "460106",
    name: "Triple-Cream Extra Salted Banquet Cheese",
    productType: "Cheese",
    category: "CHEESE",
    brand: "President",
    vendorName: "Lactalis",
    salesUnit: "KG",
    unitPriceEur: 6.9,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    // Filtered out by nutrition (calories > 420, fat > 36, salt > 2.2)
    nutrition: {
      caloriesPer100g: 465,
      fatPer100g: 43,
      sugarPer100g: 0.5,
      saltPer100g: 2.6,
      proteinPer100g: 13,
    },
  },
  // Milk products
  {
    id: "460201",
    name: "Valio Fresh Whole Milk 1L",
    productType: "Milk",
    category: "MILK",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "L",
    unitPriceEur: 1.35,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 64,
      fatPer100g: 3.5,
      sugarPer100g: 4.8,
      saltPer100g: 0.1,
      proteinPer100g: 3.3,
    },
  },
  {
    id: "460202",
    name: "Valio Eila Lactose-Free Semi-Skimmed Milk 1L",
    productType: "Milk",
    category: "MILK",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "L",
    unitPriceEur: 1.55,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 40,
      fatPer100g: 1.5,
      sugarPer100g: 3.1,
      saltPer100g: 0.1,
      proteinPer100g: 3.3,
    },
  },
  {
    id: "460203",
    name: "Soy Barista Protein Drink 1L",
    productType: "Milk",
    category: "MILK",
    brand: "Alpro",
    vendorName: "Danone",
    salesUnit: "L",
    unitPriceEur: 2.1,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    // Filtered out by excludedAllergens ("soy")
    allergens: ["soy"],
    nutrition: {
      caloriesPer100g: 42,
      fatPer100g: 1.9,
      sugarPer100g: 2.5,
      saltPer100g: 0.13,
      proteinPer100g: 3.3,
    },
  },
  // Butter & Cream products
  {
    id: "460401",
    name: "Valio Unsalted Dairy Butter 500g",
    productType: "Butter",
    category: "BUTTER",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "KG",
    unitPriceEur: 6.8,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 380,
      fatPer100g: 35,
      sugarPer100g: 0.6,
      saltPer100g: 0.1,
      proteinPer100g: 3.2,
    },
  },
  {
    id: "460501",
    name: "Valio Cooking Cream 15% Lactose-Free 1L",
    productType: "Cream",
    category: "CREAM",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "L",
    unitPriceEur: 3.2,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 165,
      fatPer100g: 15,
      sugarPer100g: 3.2,
      saltPer100g: 0.15,
      proteinPer100g: 3.1,
    },
  },
];

// In-memory store of created orders during this server process.
const createdOrdersStore = new Map<string, CreatedOrder>();

export function getCreatedOrders(): CreatedOrder[] {
  return [...createdOrdersStore.values()];
}

// ---------- Helpers ----------

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Deterministic hash in [0, 1) for enriching DB products that lack nutrition/price metadata. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** Parses quantity string like "420 kg" or "50 L" into numeric amount and unit. */
export function parseQuantityAndUnit(
  rawQuantity: string,
  fallbackUnit = "KG",
): { quantity: number; unit: string } {
  const trimmed = rawQuantity.trim();
  const match = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(trimmed);
  if (!match) {
    return { quantity: 1, unit: fallbackUnit };
  }
  const num = Number.parseFloat(match[1]!.replace(",", "."));
  const quantity = Number.isFinite(num) && num > 0 ? num : 1;
  const unit = match[2]?.trim() || fallbackUnit;
  return { quantity, unit };
}

/**
 * Calculates similarity between requested productName and candidate product name in [0, 1].
 * Combines exact/substring checks with word-level overlap and prefix matching.
 */
export function computeNameMatchScore(requestedName: string, candidateName: string): number {
  const reqNorm = requestedName.trim().toLowerCase();
  const candNorm = candidateName.trim().toLowerCase();
  if (!reqNorm || !candNorm) return 0;
  if (reqNorm === candNorm) return 1;

  const tokenize = (s: string) =>
    s
      .replace(/[^a-z0-9äöå]+/gi, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  const reqTokens = tokenize(reqNorm);
  const candTokens = tokenize(candNorm);
  if (reqTokens.length === 0 || candTokens.length === 0) return 0;

  let matchedReqTokens = 0;
  for (const rt of reqTokens) {
    if (candTokens.includes(rt)) {
      matchedReqTokens += 1;
    } else if (candTokens.some((ct) => ct.startsWith(rt) || rt.startsWith(ct))) {
      matchedReqTokens += 0.75;
    }
  }

  const reqCoverage = matchedReqTokens / reqTokens.length;
  const candCoverage = matchedReqTokens / candTokens.length;
  const substringBonus = candNorm.includes(reqNorm) ? 0.2 : 0;

  const rawScore = reqCoverage * 0.7 + candCoverage * 0.2 + substringBonus;
  return Math.min(1, Math.round(rawScore * 1000) / 1000);
}

/** Maps GS1 / Synkka allergen codes or raw strings to readable lowercase allergen names. */
function normalizeAllergenList(rawAllergens: string[]): string[] {
  const gs1Map: Record<string, string> = {
    AM: "milk",
    ML: "milk",
    AW: "gluten",
    UW: "gluten",
    AN: "tree-nuts",
    SA: "tree-nuts",
    AP: "peanuts",
    AY: "soy",
    AC: "crustaceans",
    AE: "eggs",
    AF: "fish",
  };
  const out = new Set<string>();
  for (const a of rawAllergens) {
    const upper = a.trim().toUpperCase();
    const mapped = gs1Map[upper] ?? a.trim().toLowerCase();
    if (mapped) out.add(mapped);
  }
  return [...out];
}

/** Fetch candidates matching `productType` from Postgres `valio_product` if available, plus mock catalog. */
async function getCandidatesByProductType(productType: string): Promise<RawCatalogCandidate[]> {
  const typeNorm = productType.trim().toLowerCase();
  const dbCandidates: RawCatalogCandidate[] = [];

  if (process.env.DATABASE_URL) {
    try {
      await ensureCatalogSchema();
      const pool = getPool();
      const likePattern = `%${typeNorm.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const { rows } = await pool.query<ProductRow>(
        `SELECT id, name, brand, vendor_name, category, sales_unit, allergens
         FROM valio_product
         WHERE LOWER(category) LIKE $1 OR search_text LIKE $1
         ORDER BY name, id
         LIMIT 50`,
        [likePattern],
      );

      if (rows.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const priceMap = new Map<string, number>();
        try {
          const prices = await getPrices({
            productIds: rows.map((r) => r.id),
            date: today,
          });
          for (const q of prices.quotes) {
            if (q.found && q.priceExclVat !== null) {
              priceMap.set(q.productId, q.priceExclVat);
            }
          }
        } catch {
          // Fallback to deterministic price if price lookup fails
        }

        for (const r of rows) {
          const s = hashSeed(r.id);
          const nameLower = r.name.toLowerCase();
          const dietaryTags = ["vegetarian", "gluten-free"];
          if (
            nameLower.includes("lactose-free") ||
            nameLower.includes("laktoositon") ||
            nameLower.includes("eila")
          ) {
            dietaryTags.push("lactose-free");
          }
          const allergens = normalizeAllergenList(r.allergens);
          if (
            nameLower.includes("pähkinä") ||
            nameLower.includes("walnut") ||
            nameLower.includes("nut")
          ) {
            allergens.push("tree-nuts");
          }
          if (nameLower.includes("soija") || nameLower.includes("soy")) {
            allergens.push("soy");
          }

          dbCandidates.push({
            id: r.id,
            name: r.name,
            productType,
            category: r.category,
            brand: r.brand,
            vendorName: r.vendor_name,
            salesUnit: r.sales_unit,
            unitPriceEur: priceMap.get(r.id) ?? roundCurrency(2 + s * 12),
            dietaryTags,
            allergens,
            nutrition: {
              caloriesPer100g: Math.round(120 + s * 260),
              fatPer100g: roundCurrency(4 + s * 28),
              sugarPer100g: roundCurrency(0.5 + s * 6),
              saltPer100g: roundCurrency(0.2 + s * 1.6),
              proteinPer100g: roundCurrency(5 + s * 20),
            },
          });
        }
      }
    } catch {
      // Database unavailable or empty; fall back to mock catalog below.
    }
  }

  // Match mock catalog products by productType (or include all if type is broad)
  const matchingMocks = MOCK_CATALOG_PRODUCTS.filter((p) => {
    const pt = p.productType.toLowerCase();
    const cat = p.category.toLowerCase();
    const nm = p.name.toLowerCase();
    return (
      pt.includes(typeNorm) ||
      typeNorm.includes(pt) ||
      cat.includes(typeNorm) ||
      nm.includes(typeNorm)
    );
  });

  const mergedById = new Map<string, RawCatalogCandidate>();
  for (const item of [...matchingMocks, ...dbCandidates]) {
    if (!mergedById.has(item.id)) {
      mergedById.set(item.id, item);
    }
  }

  // If no candidates matched the exact productType, return all mock products so the pipeline can still score by name.
  if (mergedById.size === 0) {
    return [...MOCK_CATALOG_PRODUCTS];
  }

  return [...mergedById.values()];
}

/**
 * Checks a candidate against customer preferences (Dietary restrictions, Allergens, Nutritions).
 * Returns an array of mismatch reasons (empty array = matches preferences).
 */
export function evaluateCustomerPreferences(
  candidate: RawCatalogCandidate,
  preferences: CustomerPreferences,
): string[] {
  const reasons: string[] = [];

  // 1. Dietary restrictions check
  const candidateDietary = new Set(candidate.dietaryTags.map((t) => t.toLowerCase()));
  for (const reqDiet of preferences.dietaryRestrictions) {
    if (!candidateDietary.has(reqDiet.toLowerCase())) {
      reasons.push(`Missing required dietary restriction: ${reqDiet}`);
    }
  }

  // 2. Allergens check
  const candidateAllergens = new Set(candidate.allergens.map((a) => a.toLowerCase()));
  for (const excluded of preferences.excludedAllergens) {
    if (candidateAllergens.has(excluded.toLowerCase())) {
      reasons.push(`Contains excluded allergen: ${excluded}`);
    }
  }

  // 3. Nutrition constraints check
  const { nutrition: limits } = preferences;
  const { nutrition: actual } = candidate;

  if (
    limits.maxCaloriesPer100g !== undefined &&
    actual.caloriesPer100g > limits.maxCaloriesPer100g
  ) {
    reasons.push(
      `Calories (${actual.caloriesPer100g} kcal/100g) exceed maximum (${limits.maxCaloriesPer100g} kcal/100g)`,
    );
  }
  if (limits.maxFatPer100g !== undefined && actual.fatPer100g > limits.maxFatPer100g) {
    reasons.push(
      `Fat (${actual.fatPer100g}g/100g) exceeds maximum (${limits.maxFatPer100g}g/100g)`,
    );
  }
  if (limits.maxSugarPer100g !== undefined && actual.sugarPer100g > limits.maxSugarPer100g) {
    reasons.push(
      `Sugar (${actual.sugarPer100g}g/100g) exceeds maximum (${limits.maxSugarPer100g}g/100g)`,
    );
  }
  if (limits.maxSaltPer100g !== undefined && actual.saltPer100g > limits.maxSaltPer100g) {
    reasons.push(
      `Salt (${actual.saltPer100g}g/100g) exceeds maximum (${limits.maxSaltPer100g}g/100g)`,
    );
  }
  if (limits.minProteinPer100g !== undefined && actual.proteinPer100g < limits.minProteinPer100g) {
    reasons.push(
      `Protein (${actual.proteinPer100g}g/100g) is below minimum (${limits.minProteinPer100g}g/100g)`,
    );
  }

  return reasons;
}

// ---------- Main Pipeline ----------

/**
 * Full procurement order creation pipeline from a user prompt:
 * 1. Extract structured items from the user prompt (`productName`, `productType`, `productQuantity`).
 * 2. Fetch candidate products by `[Product type]`.
 * 3. Score & sort candidates by best match on `[Product name]`.
 * 4. Filter out products that don't match customer preferences (Dietary restrictions, Allergens, Nutritions).
 * 5. If previous orders are available, sort by previously ordered product, then brand, then name match score.
 * 6. Compare total price against the customer budget.
 * 7. Create and return the order.
 */
export async function createOrderFromPrompt(
  input: CreateOrderFromPromptRequest,
): Promise<CreateOrderFromPromptResponse> {
  const preferences: CustomerPreferences = input.preferences ?? DEFAULT_MOCK_PREFERENCES;
  const previousOrders: PreviousOrderRecord[] =
    input.previousOrders ?? DEFAULT_MOCK_PREVIOUS_ORDERS;
  const budgetEur: number = input.budgetEur ?? DEFAULT_MOCK_BUDGET_EUR;

  // Step 1: Extract structured product requests from user prompt
  const extraction = await extractProductsFromPrompt({ prompt: input.prompt });
  const extractedItems = extraction.items;

  const previousProductIds = new Set(previousOrders.map((o) => o.productId.toLowerCase()));
  const previousProductNames = new Set(
    previousOrders.map((o) => o.productName.trim().toLowerCase()),
  );
  const previousBrands = new Set(previousOrders.map((o) => o.brand.trim().toLowerCase()));
  const hasPreviousOrders = previousOrders.length > 0;

  const pipeline: ItemProcurementTrace[] = [];
  const orderLines: OrderLineItem[] = [];

  for (const item of extractedItems) {
    // Step 2: Get list of products by [Product type]
    const rawByType = await getCandidatesByProductType(item.productType);

    // Step 3: Score and sort list of best match by [Product name]
    const scoredByName: CandidateProduct[] = rawByType
      .map((candidate) => {
        const nameMatchScore = computeNameMatchScore(item.productName, candidate.name);
        const previouslyOrderedProduct =
          previousProductIds.has(candidate.id.toLowerCase()) ||
          previousProductNames.has(candidate.name.trim().toLowerCase());
        const previouslyOrderedBrand =
          candidate.brand !== null && previousBrands.has(candidate.brand.trim().toLowerCase());

        return {
          ...candidate,
          nameMatchScore,
          previouslyOrderedProduct,
          previouslyOrderedBrand,
        };
      })
      .sort((a, b) => b.nameMatchScore - a.nameMatchScore || a.name.localeCompare(b.name));

    // Step 4: Remove entries that don't match Customer preferences (Dietary restrictions, Allergens, Nutritions)
    const survivingCandidates: CandidateProduct[] = [];
    const removedByPreferences: RemovedCandidate[] = [];

    for (const candidate of scoredByName) {
      const reasons = evaluateCustomerPreferences(candidate, preferences);
      if (reasons.length > 0) {
        removedByPreferences.push({
          id: candidate.id,
          name: candidate.name,
          brand: candidate.brand,
          reasons,
        });
      } else {
        survivingCandidates.push(candidate);
      }
    }

    // Step 5: If data about previous orders is available, sort by product, brand (then by nameMatchScore)
    const sortedCandidates = [...survivingCandidates].sort((a, b) => {
      if (hasPreviousOrders) {
        if (a.previouslyOrderedProduct !== b.previouslyOrderedProduct) {
          return a.previouslyOrderedProduct ? -1 : 1;
        }
        if (a.previouslyOrderedBrand !== b.previouslyOrderedBrand) {
          return a.previouslyOrderedBrand ? -1 : 1;
        }
      }
      if (b.nameMatchScore !== a.nameMatchScore) {
        return b.nameMatchScore - a.nameMatchScore;
      }
      return a.name.localeCompare(b.name);
    });

    const selectedProduct = sortedCandidates[0] ?? null;
    const { quantity, unit } = parseQuantityAndUnit(
      item.productQuantity,
      selectedProduct?.salesUnit ?? "KG",
    );

    pipeline.push({
      extractedItem: item,
      parsedQuantity: quantity,
      parsedUnit: unit,
      matchedByTypeCount: rawByType.length,
      removedByPreferences,
      sortedCandidates,
      selectedProduct,
    });

    if (selectedProduct) {
      const lineTotalEur = roundCurrency(selectedProduct.unitPriceEur * quantity);
      orderLines.push({
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        brand: selectedProduct.brand,
        productType: selectedProduct.productType,
        requestedProductName: item.productName,
        quantity,
        unit: selectedProduct.salesUnit || unit,
        unitPriceEur: selectedProduct.unitPriceEur,
        lineTotalEur,
        nameMatchScore: selectedProduct.nameMatchScore,
        previouslyOrderedProduct: selectedProduct.previouslyOrderedProduct,
        previouslyOrderedBrand: selectedProduct.previouslyOrderedBrand,
      });
    }
  }

  // Step 6: Compare prices to customer budget
  const totalPriceEur = roundCurrency(orderLines.reduce((sum, line) => sum + line.lineTotalEur, 0));
  const withinBudget = totalPriceEur <= budgetEur;
  const remainingBudgetEur = roundCurrency(budgetEur - totalPriceEur);
  const exceededByEur = withinBudget ? 0 : roundCurrency(totalPriceEur - budgetEur);

  const budgetComparison: BudgetComparison = {
    budgetEur,
    totalPriceEur,
    currency: "EUR",
    withinBudget,
    remainingBudgetEur,
    exceededByEur,
  };

  // Step 7: Create an order
  const orderStatus: CreatedOrder["status"] =
    orderLines.length === 0 ? "unfulfilled" : withinBudget ? "confirmed" : "pending_approval";

  const order: CreatedOrder = {
    orderId: `ORD-${randomUUID().slice(0, 8).toUpperCase()}`,
    status: orderStatus,
    createdAt: new Date().toISOString(),
    lines: orderLines,
    totalPriceEur,
    currency: "EUR",
    budgetComparison,
  };

  createdOrdersStore.set(order.orderId, order);

  return {
    prompt: input.prompt,
    extractedItems,
    preferencesUsed: preferences,
    previousOrdersUsed: previousOrders,
    pipeline,
    order,
  };
}
