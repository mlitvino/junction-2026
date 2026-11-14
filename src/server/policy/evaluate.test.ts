// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Preferences } from "../../shared/contracts/preferences.ts";
import { evaluatePolicy, type PolicyLineFacts } from "./evaluate.ts";

const prefs = (over: Partial<Preferences> = {}): Preferences => ({
  maxCo2PerKg: null,
  minDeliveryReliability: null,
  preferredOriginCountries: [],
  excludedAllergens: [],
  preferredVendors: [],
  blockedVendors: [],
  preferredBrands: [],
  maxOrderValue: null,
  autoApproveBelow: null,
  autonomy: "suggest_only",
  allowSubstitutes: false,
  language: "en",
  ...over,
});
const autonomous = (over: Partial<Preferences> = {}) =>
  prefs({ autonomy: "order_within_limits", autoApproveBelow: 250, maxOrderValue: 500, ...over });
const line = (over: Partial<PolicyLineFacts> = {}): PolicyLineFacts => ({
  productId: "469330",
  quantity: 20,
  unitPriceExclVat: 8.54,
  product: { vendorName: "Arla Oy", allergens: ["AM"], co2PerKg: 1.2, deliveryReliability: 0.97 },
  ...over,
});
const codes = (r: ReturnType<typeof evaluatePolicy>) => r.reasons.map((x) => x.code).sort();

test("defaults: every order needs an approver", () => {
  const r = evaluatePolicy(prefs(), [line()]);
  assert.equal(r.outcome, "REQUIRE_APPROVAL");
  assert.deepEqual(codes(r), ["NO_AUTO_APPROVAL", "SUGGEST_ONLY"]);
  assert.equal(r.totalExclVat, 170.8);
});

test("within limits: ALLOW", () => {
  const r = evaluatePolicy(autonomous(), [line()]);
  assert.equal(r.outcome, "ALLOW");
  assert.deepEqual(codes(r), ["WITHIN_LIMITS"]);
});

test("auto-approval limit: at or above needs approval", () => {
  const r = evaluatePolicy(autonomous({ autoApproveBelow: 170.8 }), [line()]);
  assert.equal(r.outcome, "REQUIRE_APPROVAL");
  assert.deepEqual(codes(r), ["ABOVE_AUTO_APPROVAL"]);
});

test("above max order value: DENY wins over approval", () => {
  const r = evaluatePolicy(autonomous(), [line({ quantity: 80 })]);
  assert.equal(r.outcome, "DENY");
  assert.deepEqual(codes(r), ["ABOVE_AUTO_APPROVAL", "ORDER_VALUE_TOO_HIGH"]);
});

test("total adds up across lines", () => {
  const r = evaluatePolicy(autonomous(), [line(), line({ productId: "469386", quantity: 10, unitPriceExclVat: 8.64 })]);
  assert.equal(r.totalExclVat, 257.2);
  assert.equal(r.outcome, "REQUIRE_APPROVAL");
});

test("blocked vendor and excluded allergen: DENY with the product and setting", () => {
  const r = evaluatePolicy(autonomous({ blockedVendors: ["Arla Oy"], excludedAllergens: ["AM", "GO"] }), [line()]);
  assert.equal(r.outcome, "DENY");
  assert.deepEqual(codes(r), ["BLOCKED_VENDOR", "EXCLUDED_ALLERGEN"]);
  const allergen = r.reasons.find((x) => x.code === "EXCLUDED_ALLERGEN")!;
  assert.equal(allergen.setting, "excludedAllergens");
  assert.equal(allergen.productId, "469330");
  assert.match(allergen.message, /AM/);
});

test("CO2 and reliability limits apply to known values", () => {
  const r = evaluatePolicy(autonomous({ maxCo2PerKg: 1, minDeliveryReliability: 0.99 }), [line()]);
  assert.deepEqual(codes(r), ["CO2_TOO_HIGH", "RELIABILITY_TOO_LOW"]);
});

test("missing data never triggers a rule", () => {
  const product = { vendorName: "Arla Oy", allergens: [], co2PerKg: null, deliveryReliability: null };
  const r = evaluatePolicy(
    autonomous({ maxCo2PerKg: 1, minDeliveryReliability: 0.99, excludedAllergens: ["AM"] }),
    [line({ product })],
  );
  assert.equal(r.outcome, "ALLOW");
});

test("unknown product and missing price: DENY, no total", () => {
  const r = evaluatePolicy(autonomous(), [line({ product: null }), line({ productId: "x", unitPriceExclVat: null })]);
  assert.equal(r.outcome, "DENY");
  assert.deepEqual(codes(r), ["PRICE_UNKNOWN", "UNKNOWN_PRODUCT"]);
  assert.equal(r.totalExclVat, null);
});
