// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import { rankCandidates, type RankCandidate } from "./ranking.ts";

const base: RankCandidate = {
  id: "a",
  name: "Lactose-free milk 1 L",
  brand: "Arla",
  vendorName: "ARLA OY",
  countryOfOrigin: "fi",
  labels: [],
  unitPriceExclVat: 8.5,
  salesUnit: "KI",
  perSalesUnit: { value: 5, unit: "L" },
  quantity: 200,
  orderable: true,
  salesBlock: false,
  availableDate: "2026-11-16",
  availableQuantity: null,
  deliveryReliability: 0.95,
  co2PerKg: 1.2,
  nameMatch: 0.8,
  previouslyOrderedProduct: false,
  previouslyOrderedBrand: false,
};
const prefs = { requestedDate: "2026-11-20", preferredOriginCountries: [], preferredVendors: [], preferredBrands: [] };

test("compares price per litre across pack sizes", () => {
  // 1.70 €/L in 5 L cases vs 1.60 €/L in 10 L cases: the bigger pack is cheaper per litre.
  const { ranked } = rankCandidates(
    [
      base,
      { ...base, id: "b", unitPriceExclVat: 16, perSalesUnit: { value: 10, unit: "L" }, quantity: 100 },
    ],
    prefs,
  );
  assert.equal(ranked[0]!.id, "b");
  assert.deepEqual(ranked[0]!.pricePerContent, { value: 1.6, unit: "L" });
  assert.match(ranked[0]!.reasons[0]!, /€1\.60\/L, cheapest/);
  assert.equal(ranked[0]!.tier, "best");
  assert.equal(ranked[1]!.tier, "better");
  assert.equal(ranked[0]!.lineTotalExclVat, 1600);
});

test("late delivery and short stock lower the score; blocked and unpriced are unavailable", () => {
  const { ranked, unavailable } = rankCandidates(
    [
      base,
      { ...base, id: "late", unitPriceExclVat: 8, availableDate: "2026-11-23" },
      { ...base, id: "short", unitPriceExclVat: 8, availableQuantity: 10 },
      { ...base, id: "blocked", salesBlock: true },
      { ...base, id: "noprice", unitPriceExclVat: null },
    ],
    prefs,
  );
  assert.equal(ranked[0]!.id, "a");
  assert.deepEqual(unavailable.map((u) => u.id).sort(), ["blocked", "noprice"]);
  assert.ok(ranked.find((r) => r.id === "late")!.reasons.some((r) => r.includes("after 2026-11-20")));
  assert.ok(ranked.find((r) => r.id === "short")!.reasons.some((r) => r.includes("only 10")));
});

test("organization preferences and sustainability labels count", () => {
  const { ranked } = rankCandidates(
    [
      { ...base, id: "se", countryOfOrigin: "se", brand: "Other", vendorName: "OTHER" },
      { ...base, id: "fi-organic", labels: ["EU_ORGANIC_FARMING"] },
    ],
    { ...prefs, preferredOriginCountries: ["fi"], preferredBrands: ["arla"] },
  );
  assert.equal(ranked[0]!.id, "fi-organic");
  const reasons = ranked[0]!.reasons.join(" | ");
  assert.match(reasons, /preferred origin \(FI\)/);
  assert.match(reasons, /preferred brand/);
  assert.match(reasons, /EU organic/);
});

test("products that can't take the requested amount don't compete", () => {
  const { ranked, unavailable } = rankCandidates(
    [base, { ...base, id: "cup", unitPriceExclVat: 0.58, salesUnit: "ST", perSalesUnit: { value: 0.2, unit: "KG" }, quantity: 1000, converted: false }],
    prefs,
  );
  assert.deepEqual(ranked.map((r) => r.id), ["a"]);
  assert.match(unavailable[0]!.reason, /can't be converted/);
  // If nothing converts, everything still competes (per sales unit).
  const none = rankCandidates([{ ...base, converted: false }, { ...base, id: "b", converted: false }], prefs);
  assert.equal(none.ranked.length, 2);
});

test("falls back to price per sales unit when content is unknown for some", () => {
  const { ranked } = rankCandidates([base, { ...base, id: "b", perSalesUnit: null, unitPriceExclVat: 9 }], prefs);
  assert.equal(ranked[0]!.pricePerContent, null);
  assert.match(ranked[0]!.reasons[0]!, /\/KI/);
});
