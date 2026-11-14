import "server-only";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { valioProduct } from "@/server/db/schema";
import { allergenCodes, allergenNames } from "@/shared/contracts/allergens";

import type { NutritionProfile } from "@/shared/contracts/catalog";

export type UnifiedCatalogRecord = {
  id: string;
  name: string;
  productType: string;
  category: string;
  brand: string | null;
  vendorName: string;
  salesUnit: string;
  baseUnit: string;
  allowedLotSize: number;
  gtin: string | null;
  countryOfOrigin: string | null;
  netWeightKg: number | null;
  storageTempC: { min: number | null; max: number | null } | null;
  unitPriceEur: number;
  vatRatePct: number;
  availableQuantity: number | null;
  logisticModel: "stock" | "terminal";
  deliveryReliability: number | null;
  co2PerKg: number | null;
  dietaryTags: string[];
  allergens: string[];
  /** Null for real products: the catalog import doesn't carry nutrition yet. */
  nutrition: NutritionProfile | null;
  substituteIds: string[];
  /** Earliest delivery date from Valio for the requested date; absent for synthetic products. */
  availableDate?: string | null;
  salesBlock?: boolean;
  /** Packaging label ids (shared/contracts/labels.ts). */
  labels?: string[];
  sustainabilityCertificates?: string[];
  leadTimeDays?: number;
  isSeasonal?: boolean;
  isNewArrival?: boolean;
};

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Deterministic hash in [0, 1) for enriching DB products that lack nutrition/price metadata. */
export function hashSeed(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** Maps GS1 allergen codes (or names) to readable lowercase allergen names (shared/contracts/allergens.ts). */
export function normalizeAllergenList(rawAllergens: string[]): string[] {
  return allergenNames([...allergenCodes(rawAllergens)]);
}

/**
 * Dietary tags, allergen names and nutrition of a real catalog product, from the imported data
 * (claims, GS1 allergens, nutritionFact). Name hints only ADD allergens (safer), never dietary tags.
 */
export function realProductFacts(p: {
  name: string;
  allergens: string[];
  dietaryTags: string[];
  nutrition?: Record<string, number | null> | null;
}): { dietaryTags: string[]; allergens: string[]; nutrition: NutritionProfile | null } {
  const hinted = inferDietaryAndAllergensFromProduct(p.name, p.allergens).allergens;
  const n = p.nutrition;
  const num = (v: number | null | undefined) => (typeof v === "number" ? v : null);
  return {
    dietaryTags: p.dietaryTags,
    allergens: [...new Set([...allergenNames(p.allergens), ...hinted])],
    nutrition:
      n && [n.energyKcal, n.fat, n.sugars, n.salt, n.protein].some((v) => typeof v === "number")
        ? {
            caloriesPer100g: num(n.energyKcal) ?? 0,
            fatPer100g: num(n.fat) ?? 0,
            sugarPer100g: num(n.sugars) ?? 0,
            saltPer100g: num(n.salt) ?? 0,
            proteinPer100g: num(n.protein) ?? 0,
          }
        : null,
  };
}

export function inferDietaryAndAllergensFromProduct(name: string, rawAllergens: string[]) {
  const nameLower = name.toLowerCase();
  const isPlantBased =
    nameLower.includes("vegan") ||
    nameLower.includes("vegaan") ||
    nameLower.includes("veggie") ||
    nameLower.includes("plant-based") ||
    nameLower.includes("oddlygood") ||
    nameLower.includes("mifu");
  const isMeatOrFish =
    !isPlantBased &&
    /\b(salmon|lohi|trout|kirjolohi|fish|kala|beef|nauta|pork|possu|sika|chicken|broileri|kana|bacon|pekoni)\b/i.test(
      nameLower,
    );

  const dietaryTags: string[] = [];
  if (!isMeatOrFish) {
    dietaryTags.push("vegetarian");
  }
  if (!/\b(wheat|vehnä|barley|ohra|rye|ruis|bread|leipä|pasta)\b/i.test(nameLower)) {
    dietaryTags.push("gluten-free");
  }
  if (
    nameLower.includes("lactose-free") ||
    nameLower.includes("laktoositon") ||
    nameLower.includes("eila") ||
    isPlantBased
  ) {
    dietaryTags.push("lactose-free");
  }
  if (nameLower.includes("vegan") || nameLower.includes("vegaan")) {
    dietaryTags.push("vegan");
  }

  const allergens = normalizeAllergenList(rawAllergens);
  if (
    (nameLower.includes("pähkinä") ||
      nameLower.includes("walnut") ||
      nameLower.includes("almond")) &&
    !allergens.includes("tree-nuts")
  ) {
    allergens.push("tree-nuts");
  }
  if ((nameLower.includes("soija") || nameLower.includes("soy")) && !allergens.includes("soy")) {
    allergens.push("soy");
  }
  if (
    !isPlantBased &&
    /\b(salmon|lohi|trout|kirjolohi|fish|kala)\b/i.test(nameLower) &&
    !allergens.includes("fish")
  ) {
    allergens.push("fish");
  }
  return { dietaryTags, allergens };
}


const RAW_MOCK_CATALOG_PRODUCTS: UnifiedCatalogRecord[] = [
  // Cheese products (some pass preferences, some fail dietary/allergens/nutrition to demonstrate filtering)
  {
    id: "460101",
    name: "Valio Oltermanni Creamy Cheese 1kg",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430001019",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 5.4,
    vatRatePct: 14,
    availableQuantity: 650,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 4.9,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 330,
      fatPer100g: 26,
      sugarPer100g: 0,
      saltPer100g: 1.4,
      proteinPer100g: 24,
    },
    substituteIds: ["460102", "460301"],
  },
  {
    id: "460102",
    name: "Valio Polar Creamy Cheese Mild 500g",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430001026",
    countryOfOrigin: "fi",
    netWeightKg: 0.5,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 5.8,
    vatRatePct: 14,
    availableQuantity: 500,
    logisticModel: "stock",
    deliveryReliability: 0.98,
    co2PerKg: 4.7,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 285,
      fatPer100g: 19,
      sugarPer100g: 0,
      saltPer100g: 1.3,
      proteinPer100g: 28,
    },
    substituteIds: ["460101", "460301"],
  },
  {
    id: "460301",
    name: "Arla Creamy Havarti Cheese 1kg",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Arla",
    vendorName: "Arla Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430003013",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 5.6,
    vatRatePct: 14,
    availableQuantity: 600,
    logisticModel: "stock",
    deliveryReliability: 0.97,
    co2PerKg: 5.1,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 350,
      fatPer100g: 29,
      sugarPer100g: 0.2,
      saltPer100g: 1.6,
      proteinPer100g: 22,
    },
    substituteIds: ["460101", "460102"],
  },
  {
    id: "460104",
    name: "Artisan Walnut Creamy Cheese Spread",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Castello",
    vendorName: "Arla Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430001040",
    countryOfOrigin: "dk",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 7.2,
    vatRatePct: 14,
    availableQuantity: 250,
    logisticModel: "stock",
    deliveryReliability: 0.94,
    co2PerKg: 5.4,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk", "tree-nuts"],
    nutrition: {
      caloriesPer100g: 375,
      fatPer100g: 33,
      sugarPer100g: 1.2,
      saltPer100g: 1.5,
      proteinPer100g: 16,
    },
    substituteIds: ["460101"],
  },
  {
    id: "460105",
    name: "Traditional Animal-Rennet Aged Creamy Cheese",
    productType: "Cheese",
    category: "CHEESE",
    brand: "Kuusamon",
    vendorName: "Kuusamon Juusto Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430001057",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 6.1,
    vatRatePct: 14,
    availableQuantity: 300,
    logisticModel: "stock",
    deliveryReliability: 0.96,
    co2PerKg: 5.3,
    dietaryTags: ["gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 390,
      fatPer100g: 32,
      sugarPer100g: 0,
      saltPer100g: 1.8,
      proteinPer100g: 25,
    },
    substituteIds: ["460101"],
  },
  {
    id: "460106",
    name: "Triple-Cream Extra Salted Banquet Cheese",
    productType: "Cheese",
    category: "CHEESE",
    brand: "President",
    vendorName: "Lactalis",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430001064",
    countryOfOrigin: "fr",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 6.9,
    vatRatePct: 14,
    availableQuantity: 180,
    logisticModel: "stock",
    deliveryReliability: 0.92,
    co2PerKg: 6.1,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 465,
      fatPer100g: 43,
      sugarPer100g: 0.5,
      saltPer100g: 2.6,
      proteinPer100g: 13,
    },
    substituteIds: ["460101"],
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
    baseUnit: "L",
    allowedLotSize: 1,
    gtin: "6408430002016",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 1.35,
    vatRatePct: 14,
    availableQuantity: 900,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 1.1,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 64,
      fatPer100g: 3.5,
      sugarPer100g: 4.8,
      saltPer100g: 0.1,
      proteinPer100g: 3.3,
    },
    substituteIds: ["460202"],
  },
  {
    id: "460202",
    name: "Valio Eila Lactose-Free Semi-Skimmed Milk 1L",
    productType: "Milk",
    category: "MILK",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "L",
    baseUnit: "L",
    allowedLotSize: 1,
    gtin: "6408430002023",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 1.55,
    vatRatePct: 14,
    availableQuantity: 750,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 1.05,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 40,
      fatPer100g: 1.5,
      sugarPer100g: 3.1,
      saltPer100g: 0.1,
      proteinPer100g: 3.3,
    },
    substituteIds: ["460201"],
  },
  {
    id: "460203",
    name: "Soy Barista Protein Drink 1L",
    productType: "Milk",
    category: "MILK",
    brand: "Alpro",
    vendorName: "Danone",
    salesUnit: "L",
    baseUnit: "L",
    allowedLotSize: 1,
    gtin: "5411188112031",
    countryOfOrigin: "be",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 25 },
    unitPriceEur: 2.1,
    vatRatePct: 14,
    availableQuantity: 400,
    logisticModel: "stock",
    deliveryReliability: 0.95,
    co2PerKg: 0.45,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: ["soy"],
    nutrition: {
      caloriesPer100g: 42,
      fatPer100g: 1.9,
      sugarPer100g: 2.5,
      saltPer100g: 0.13,
      proteinPer100g: 3.3,
    },
    substituteIds: ["460202"],
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
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430004010",
    countryOfOrigin: "fi",
    netWeightKg: 0.5,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 6.8,
    vatRatePct: 14,
    availableQuantity: 450,
    logisticModel: "stock",
    deliveryReliability: 0.98,
    co2PerKg: 8.2,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 380,
      fatPer100g: 35,
      sugarPer100g: 0.6,
      saltPer100g: 0.1,
      proteinPer100g: 3.2,
    },
    substituteIds: [],
  },
  {
    id: "460501",
    name: "Valio Cooking Cream 15% Lactose-Free 1L",
    productType: "Cream",
    category: "CREAM",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "L",
    baseUnit: "L",
    allowedLotSize: 1,
    gtin: "6408430005017",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 3.2,
    vatRatePct: 14,
    availableQuantity: 520,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 2.6,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 165,
      fatPer100g: 15,
      sugarPer100g: 3.2,
      saltPer100g: 0.15,
      proteinPer100g: 3.1,
    },
    substituteIds: ["460503"],
    sustainabilityCertificates: [
      "Hyvää Suomesta (Produced in Finland)",
      "Valio Carbo® Climate-Reduced Chain",
      "Heart Symbol",
    ],
    leadTimeDays: 1,
  },
  {
    id: "460502",
    name: "Valio Heavy Whipping Cream 38% 1L",
    productType: "Cream",
    category: "CREAM",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "L",
    baseUnit: "L",
    allowedLotSize: 1,
    gtin: "6408430005024",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 4.1,
    vatRatePct: 14,
    availableQuantity: 0,
    logisticModel: "stock",
    deliveryReliability: 0.96,
    co2PerKg: 3.8,
    dietaryTags: ["vegetarian", "gluten-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 360,
      fatPer100g: 38,
      sugarPer100g: 2.9,
      saltPer100g: 0.1,
      proteinPer100g: 2.1,
    },
    substituteIds: ["460501", "460503"],
    sustainabilityCertificates: ["Hyvää Suomesta (Produced in Finland)"],
    leadTimeDays: 2,
  },
  {
    id: "460503",
    name: "Oddlygood Planti Cooking Oat Cream 15% Gluten-Free 1L",
    productType: "Cream",
    category: "CREAM",
    brand: "Oddlygood",
    vendorName: "Oddlygood Global Oy",
    salesUnit: "L",
    baseUnit: "L",
    allowedLotSize: 1,
    gtin: "6408430005031",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 3.05,
    vatRatePct: 14,
    availableQuantity: 420,
    logisticModel: "stock",
    deliveryReliability: 0.98,
    co2PerKg: 0.72,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 155,
      fatPer100g: 15,
      sugarPer100g: 1.8,
      saltPer100g: 0.12,
      proteinPer100g: 3.1,
    },
    substituteIds: ["460501"],
    sustainabilityCertificates: [
      "Hyvää Suomesta (Produced in Finland)",
      "Carbon Footprint Verified",
      "Heart Symbol",
    ],
    leadTimeDays: 1,
    isNewArrival: true,
  },
  // Fish & Plant-Based Seafood products (for Salmon Soup recipe under any dietary profile)
  {
    id: "460601",
    name: "Valio Aimo Fresh Nordic Salmon Fillet Skinless 1kg",
    productType: "Fish",
    category: "FISH",
    brand: "Valio Aimo",
    vendorName: "Kalatukku E. Eriksson",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430006014",
    countryOfOrigin: "no",
    netWeightKg: 1,
    storageTempC: { min: 0, max: 3 },
    unitPriceEur: 16.9,
    vatRatePct: 14,
    availableQuantity: 180,
    logisticModel: "stock",
    deliveryReliability: 0.98,
    co2PerKg: 5.2,
    dietaryTags: ["gluten-free", "lactose-free"],
    allergens: ["fish"],
    nutrition: {
      caloriesPer100g: 208,
      fatPer100g: 13,
      sugarPer100g: 0,
      saltPer100g: 0.12,
      proteinPer100g: 20,
    },
    substituteIds: ["460602", "460603"],
    sustainabilityCertificates: ["ASC Certified", "Traceable Nordic Aquaculture"],
    leadTimeDays: 1,
  },
  {
    id: "460602",
    name: "Åland Rainbow Trout Salmon-Family Fillet 1kg",
    productType: "Fish",
    category: "FISH",
    brand: "Hätälä",
    vendorName: "Hätälä Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430006021",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 0, max: 3 },
    unitPriceEur: 14.8,
    vatRatePct: 14,
    availableQuantity: 240,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 4.1,
    dietaryTags: ["gluten-free", "lactose-free"],
    allergens: ["fish"],
    nutrition: {
      caloriesPer100g: 185,
      fatPer100g: 10.5,
      sugarPer100g: 0,
      saltPer100g: 0.1,
      proteinPer100g: 21,
    },
    substituteIds: ["460601", "460603"],
    sustainabilityCertificates: ["Hyvää Suomesta (Produced in Finland)", "ASC Certified"],
    leadTimeDays: 1,
  },
  {
    id: "460603",
    name: "Oddlygood Veggie Salmon-Style Fillet Cubes 1kg",
    productType: "Fish",
    category: "FISH",
    brand: "Oddlygood",
    vendorName: "Oddlygood Global Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430006038",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 12.4,
    vatRatePct: 14,
    availableQuantity: 300,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 1.5,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 168,
      fatPer100g: 7.5,
      sugarPer100g: 0.8,
      saltPer100g: 1.1,
      proteinPer100g: 18,
    },
    substituteIds: ["460601", "460602"],
    sustainabilityCertificates: [
      "Hyvää Suomesta (Produced in Finland)",
      "Carbon Footprint Verified",
      "Heart Symbol",
    ],
    leadTimeDays: 1,
    isNewArrival: true,
  },
  // Potatoes, Vegetables & Fresh Herbs (for Salmon Soup & Canteen Recipes)
  {
    id: "460701",
    name: "Valio Aimo Finnish Peeled Diced Potatoes 5kg",
    productType: "Potato",
    category: "VEGETABLES",
    brand: "Valio Aimo",
    vendorName: "Tuorekartano Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430007011",
    countryOfOrigin: "fi",
    netWeightKg: 5,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 1.85,
    vatRatePct: 14,
    availableQuantity: 800,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 0.32,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 76,
      fatPer100g: 0.1,
      sugarPer100g: 0.8,
      saltPer100g: 0.02,
      proteinPer100g: 3.1,
    },
    substituteIds: ["460702"],
    sustainabilityCertificates: ["Hyvää Suomesta (Produced in Finland)", "IP-Kasvikset Certified"],
    leadTimeDays: 1,
  },
  {
    id: "460702",
    name: "Luomu Organic Finnish Diced Soup Potatoes 5kg",
    productType: "Potato",
    category: "VEGETABLES",
    brand: "Tuorekartano",
    vendorName: "Tuorekartano Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430007028",
    countryOfOrigin: "fi",
    netWeightKg: 5,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 2.25,
    vatRatePct: 14,
    availableQuantity: 450,
    logisticModel: "stock",
    deliveryReliability: 0.98,
    co2PerKg: 0.26,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 75,
      fatPer100g: 0.1,
      sugarPer100g: 0.7,
      saltPer100g: 0.02,
      proteinPer100g: 3.2,
    },
    substituteIds: ["460701"],
    sustainabilityCertificates: [
      "EU Organic",
      "Luomu Sun Label",
      "Hyvää Suomesta (Produced in Finland)",
    ],
    leadTimeDays: 1,
  },
  {
    id: "460703",
    name: "Valio Aimo Fresh Washed Sliced Leek 1kg",
    productType: "Vegetables",
    category: "VEGETABLES",
    brand: "Valio Aimo",
    vendorName: " vihannestukku Kespro/Aimo",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430007035",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 3.4,
    vatRatePct: 14,
    availableQuantity: 320,
    logisticModel: "stock",
    deliveryReliability: 0.98,
    co2PerKg: 0.48,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 61,
      fatPer100g: 0.3,
      sugarPer100g: 3.9,
      saltPer100g: 0.05,
      proteinPer100g: 3.1,
    },
    substituteIds: ["460704"],
    sustainabilityCertificates: ["Hyvää Suomesta (Produced in Finland)"],
    leadTimeDays: 1,
  },
  {
    id: "460704",
    name: "Valio Aimo Diced Finnish Carrots 2.5kg",
    productType: "Vegetables",
    category: "VEGETABLES",
    brand: "Valio Aimo",
    vendorName: "Tuorekartano Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430007042",
    countryOfOrigin: "fi",
    netWeightKg: 2.5,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 1.95,
    vatRatePct: 14,
    availableQuantity: 500,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 0.29,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 41,
      fatPer100g: 0.2,
      sugarPer100g: 4.7,
      saltPer100g: 0.07,
      proteinPer100g: 3.0,
    },
    substituteIds: ["460703"],
    sustainabilityCertificates: ["Hyvää Suomesta (Produced in Finland)"],
    leadTimeDays: 1,
  },
  {
    id: "460801",
    name: "Järvikylä Fresh Finnish Dill Culinary Pack 1kg",
    productType: "Herbs",
    category: "HERBS",
    brand: "Järvikylä",
    vendorName: "Famifarm Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 0.1,
    gtin: "6408430008018",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 4, max: 8 },
    unitPriceEur: 14.8,
    vatRatePct: 14,
    availableQuantity: 95,
    logisticModel: "stock",
    deliveryReliability: 0.98,
    co2PerKg: 0.9,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 43,
      fatPer100g: 1.1,
      sugarPer100g: 0.5,
      saltPer100g: 0.15,
      proteinPer100g: 3.5,
    },
    substituteIds: [],
    sustainabilityCertificates: [
      "Hyvää Suomesta (Produced in Finland)",
      "Sirkka Leaf Greenhouse Standard",
    ],
    leadTimeDays: 1,
  },
  {
    id: "460901",
    name: "Puljonki Classic Vegetable & Herb Fond Gluten-Free 1L",
    productType: "Broth",
    category: "BROTH",
    brand: "Puljonki",
    vendorName: "Puljonki Oy",
    salesUnit: "L",
    baseUnit: "L",
    allowedLotSize: 1,
    gtin: "6408430009015",
    countryOfOrigin: "fi",
    netWeightKg: 1,
    storageTempC: { min: 2, max: 8 },
    unitPriceEur: 6.2,
    vatRatePct: 14,
    availableQuantity: 210,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 0.75,
    dietaryTags: ["vegan", "vegetarian", "gluten-free", "lactose-free"],
    allergens: [],
    nutrition: {
      caloriesPer100g: 28,
      fatPer100g: 0.4,
      sugarPer100g: 1.2,
      saltPer100g: 1.3,
      proteinPer100g: 3.1,
    },
    substituteIds: [],
    sustainabilityCertificates: ["Hyvää Suomesta (Produced in Finland)"],
    leadTimeDays: 1,
  },
  // Seasonal supplier recommendation item (Optional Feature #12)
  {
    id: "461001",
    name: "Valio Seasonal Lapland Cloudberry Quark Lactose-Free 2.5kg",
    productType: "Yogurt",
    category: "YOGURT",
    brand: "Valio",
    vendorName: "Valio Oy",
    salesUnit: "KG",
    baseUnit: "KG",
    allowedLotSize: 1,
    gtin: "6408430010011",
    countryOfOrigin: "fi",
    netWeightKg: 2.5,
    storageTempC: { min: 2, max: 6 },
    unitPriceEur: 4.9,
    vatRatePct: 14,
    availableQuantity: 220,
    logisticModel: "stock",
    deliveryReliability: 0.99,
    co2PerKg: 1.4,
    dietaryTags: ["vegetarian", "gluten-free", "lactose-free"],
    allergens: ["milk"],
    nutrition: {
      caloriesPer100g: 98,
      fatPer100g: 2.0,
      sugarPer100g: 8.5,
      saltPer100g: 0.1,
      proteinPer100g: 9.5,
    },
    substituteIds: [],
    sustainabilityCertificates: [
      "Hyvää Suomesta (Produced in Finland)",
      "Valio Carbo® Climate-Reduced Chain",
      "Nordic Wild Harvest Berry",
    ],
    leadTimeDays: 1,
    isSeasonal: true,
    isNewArrival: true,
  },
];

/** Prefix of synthetic product ids. They must never look like real Valio codes. */
export const SYNTHETIC_ID_PREFIX = "SYN-";
export const syntheticId = (id: string) => (id.startsWith(SYNTHETIC_ID_PREFIX) ? id : `${SYNTHETIC_ID_PREFIX}${id}`);
export const isSyntheticId = (id: string) => id.startsWith(SYNTHETIC_ID_PREFIX);

/**
 * Synthetic demo products, used only when the real catalog is empty (`syntheticCatalogEnabled`).
 * Their ids carry the `SYN-` prefix: the codes they were written with belong to unrelated real
 * Valio products (e.g. 460101 is peaches), so an unprefixed id would order the wrong product.
 */
export const MOCK_CATALOG_PRODUCTS: UnifiedCatalogRecord[] = RAW_MOCK_CATALOG_PRODUCTS.map((p) => ({
  ...p,
  id: syntheticId(p.id),
  substituteIds: p.substituteIds.map(syntheticId),
}));

export const MOCK_CATALOG_BY_ID = new Map(MOCK_CATALOG_PRODUCTS.map((p) => [p.id, p]));

let catalogEmpty: Promise<boolean> | undefined;

/**
 * True when there is no real catalog to work with (no database, or `pnpm data:import` not run):
 * only then may synthetic products be offered. Re-checked until the catalog has data.
 */
export async function syntheticCatalogEnabled(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return true;
  catalogEmpty ??= (async () => {
    await ensureDatabase();
    const [row] = await getDb().select({ id: valioProduct.id }).from(valioProduct).limit(1);
    return !row;
  })().catch(() => true);
  const empty = await catalogEmpty;
  if (empty) catalogEmpty = undefined;
  return empty;
}
