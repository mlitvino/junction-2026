// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import { toSalesUnits, type UnitFacts } from "./units.ts";

// Arla lactose-free milk 469330: sold in cases (KI) of 5 cartons (ST) of 1 L.
const milk: UnitFacts = {
  salesUnit: "KI",
  baseUnit: "ST",
  units: [
    { unitId: "KI", sizeInBaseUnits: 5 },
    { unitId: "ST", sizeInBaseUnits: 1 },
  ],
  contentPerBaseUnit: 1,
  contentUnit: "L",
};
// Potato salad 400 g, sold per piece (RAS).
const salad: UnitFacts = {
  salesUnit: "RAS",
  baseUnit: "RAS",
  units: [{ unitId: "KI", sizeInBaseUnits: 5 }, { unitId: "RAS", sizeInBaseUnits: 1 }],
  contentPerBaseUnit: 0.4,
  contentUnit: "KG",
};

test("litres become cases through the declared content", () => {
  const c = toSalesUnits(1000, "L", milk);
  assert.equal(c.quantity, 200);
  assert.equal(c.converted, true);
  assert.deepEqual(c.perSalesUnit, { value: 5, unit: "L" });
  assert.match(c.note, /1000 L → 200 KI \(5 L each\)/);
});

test("rounds up to whole sales units; dl/ml/litres spellings work", () => {
  assert.equal(toSalesUnits(12, "litres", milk).quantity, 3);
  assert.equal(toSalesUnits(25, "dl", milk).quantity, 1);
  assert.equal(toSalesUnits(5000, "ml", milk).quantity, 1);
});

test("weights convert for weighed products", () => {
  assert.equal(toSalesUnits(10, "kg", salad).quantity, 25);
  assert.equal(toSalesUnits(1000, "g", salad).quantity, 3);
});

test("packaging words and codes", () => {
  assert.equal(toSalesUnits(20, "cases", milk).quantity, 20);
  assert.equal(toSalesUnits(12, "pcs", milk).quantity, 3);
  assert.equal(toSalesUnits(12, "ST", milk).quantity, 3);
  assert.equal(toSalesUnits(2, "KI", salad).quantity, 10);
  assert.equal(toSalesUnits(7, "", milk).quantity, 7);
  assert.equal(toSalesUnits(7, "KI", milk).note.startsWith("7 KI"), true);
});

test("unconvertible requests keep the number and say why", () => {
  const wrongDimension = toSalesUnits(10, "kg", milk);
  assert.equal(wrongDimension.converted, false);
  assert.equal(wrongDimension.quantity, 10);
  assert.match(wrongDimension.note, /measured in L/);
  const noContent = toSalesUnits(10, "L", { ...milk, contentPerBaseUnit: null, contentUnit: null });
  assert.equal(noContent.converted, false);
  assert.match(noContent.note, /doesn't declare/);
  assert.match(toSalesUnits(3, "bags", milk).note, /unknown unit/);
});
