// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProducts, type DataIssue } from "./valio-data.ts";

// Trimmed from data/valio/products.json (469330, Arla lactose-free milk, 5 × 1 L per case).
const raw = {
  id: "469330",
  salesUnit: "KI",
  baseUnit: "ST",
  category: "MILK",
  allowedLotSize: 1,
  deleted: false,
  vendorName: "ARLA OY",
  units: [
    { unitId: "KI", sizeInBaseUnits: 5 },
    { unitId: "ST", sizeInBaseUnits: 1 },
  ],
  synkkaData: {
    names: [{ value: "5 x Arla 1 L lactose free semi-skimmed milk drink", language: "en" }],
    medias: [],
    unitConversions: [{ synkkaPackagingType: "CASE", volume: { unit: "LTR", value: 5 } }],
    classifications: [
      { name: "allergen", values: [{ id: "AM", unit: "CONTAINS" }, { id: "SA", unit: "MAY_CONTAIN" }, { id: "AC", unit: "UNDECLARED" }] },
      { name: "nutritionFact", values: [{ id: "ENER-E14", value: 38, unit: "E14" }, { id: "FAT", value: 1.5, unit: "GRM" }, { id: "SALTEQ", value: 0.09, unit: "GRM" }] },
      { name: "packagingMarkedLabel", values: [{ id: "GOODS_FROM_FINLAND_BLUE_SWAN" }, { id: "coolTemperature" }] },
      { name: "nutritionalClaim", values: [{ id: "FREE_FROM_LACTOSE", unit: "FREE_FROM" }] },
    ],
  },
};

test("imports content, allergen qualifiers, nutrition, labels and claims", () => {
  const issues: DataIssue[] = [];
  const p = parseProducts([raw], issues).get("469330")!;
  assert.deepEqual(issues, []);
  assert.equal(p.contentPerBaseUnit, 1);
  assert.equal(p.contentUnit, "L");
  assert.deepEqual(p.allergens, ["AM"]);
  assert.deepEqual(p.mayContainAllergens, ["SA"]);
  assert.equal(p.nutrition?.energyKcal, 38);
  assert.equal(p.nutrition?.salt, 0.09);
  assert.equal(p.nutrition?.protein, null);
  assert.deepEqual(p.labels, ["GOODS_FROM_FINLAND_BLUE_SWAN"]);
  assert.deepEqual(p.claims, ["FREE_FROM_LACTOSE"]);
  assert.deepEqual(p.dietaryTags, ["lactose-free"]);
});
