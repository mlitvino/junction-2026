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
  dietaryRestrictions: [],
  allowedCategories: [],
  blockedCategories: [],
  allowedProductIds: [],
  blockedProductIds: [],
  preferredVendors: [],
  blockedVendors: [],
  preferredBrands: [],
  maxOrderValue: null,
  maxUnitPrice: null,
  maxLineQuantity: null,
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

// ----- Availability -----
const avail = (over: Partial<NonNullable<PolicyLineFacts["availability"]>> = {}) => ({
  orderable: true,
  salesBlock: false,
  availableDate: "2026-11-16",
  availableQuantity: null,
  salesUnit: "KI",
  ...over,
});
const at = { requestedDate: "2026-11-20" };

test("available in time, unknown quantity: no availability rule", () => {
  const r = evaluatePolicy(autonomous(), [line({ salesUnit: "KI", availability: avail() })], at);
  assert.equal(r.outcome, "ALLOW");
});

test("sales block and not orderable: DENY", () => {
  const r = evaluatePolicy(
    autonomous(),
    [
      line({ quantity: 1, availability: avail({ salesBlock: true, orderable: false }) }),
      line({ productId: "b", quantity: 1, availability: avail({ orderable: false, availableDate: null }) }),
    ],
    at,
  );
  assert.equal(r.outcome, "DENY");
  assert.deepEqual(codes(r), ["NOT_ORDERABLE", "SALES_BLOCKED"]);
});

test("later than requested: approval, with the dates in the message", () => {
  const r = evaluatePolicy(autonomous(), [line({ availability: avail({ availableDate: "2026-11-23" }) })], at);
  assert.equal(r.outcome, "REQUIRE_APPROVAL");
  assert.deepEqual(codes(r), ["LATE_DELIVERY"]);
  assert.match(r.reasons[0]!.message, /2026-11-23.*2026-11-20/);
});

test("same day as requested is in time; date-time strings compare by date", () => {
  const r = evaluatePolicy(autonomous(), [line({ availability: avail({ availableDate: "2026-11-20T00:00:00+0200" }) })], at);
  assert.equal(r.outcome, "ALLOW");
});

test("known stock below quantity: approval (same unit only)", () => {
  const short = evaluatePolicy(autonomous(), [line({ salesUnit: "KI", availability: avail({ availableQuantity: 5 }) })], at);
  assert.deepEqual(codes(short), ["INSUFFICIENT_STOCK"]);
  const otherUnit = evaluatePolicy(
    autonomous(),
    [line({ salesUnit: "KI", availability: avail({ availableQuantity: 5, salesUnit: "ST" }) })],
    at,
  );
  assert.equal(otherUnit.outcome, "ALLOW");
  const enough = evaluatePolicy(autonomous(), [line({ salesUnit: "KI", availability: avail({ availableQuantity: 20 }) })], at);
  assert.equal(enough.outcome, "ALLOW");
});

test("no availability answer: approval", () => {
  const r = evaluatePolicy(autonomous(), [line({ availability: null })], at);
  assert.equal(r.outcome, "REQUIRE_APPROVAL");
  assert.deepEqual(codes(r), ["AVAILABILITY_UNKNOWN"]);
});

test("DENY on availability beats approval on the total", () => {
  const r = evaluatePolicy(autonomous(), [line({ quantity: 40, availability: avail({ salesBlock: true }) })], at);
  assert.equal(r.outcome, "DENY");
  assert.deepEqual(codes(r), ["ABOVE_AUTO_APPROVAL", "SALES_BLOCKED"]);
});

// ----- Organization limits per line (from the former guardrails) -----
test("allergen names and codes are the same rule", () => {
  const byName = evaluatePolicy(autonomous({ excludedAllergens: ["milk"] }), [line()]);
  const byCode = evaluatePolicy(autonomous({ excludedAllergens: ["am"] }), [line()]);
  assert.deepEqual(codes(byName), ["EXCLUDED_ALLERGEN"]);
  assert.deepEqual(codes(byCode), ["EXCLUDED_ALLERGEN"]);
  const lactose = evaluatePolicy(autonomous({ excludedAllergens: ["milk"] }), [
    line({ product: { vendorName: "X", allergens: ["ML"], co2PerKg: null, deliveryReliability: null } }),
  ]);
  assert.deepEqual(codes(lactose), ["EXCLUDED_ALLERGEN"]);
});

test("unit price and line quantity caps need approval", () => {
  const r = evaluatePolicy(autonomous({ maxUnitPrice: 8, maxLineQuantity: 10 }), [line()]);
  assert.equal(r.outcome, "REQUIRE_APPROVAL");
  assert.deepEqual(codes(r), ["LINE_QUANTITY_TOO_HIGH", "UNIT_PRICE_TOO_HIGH"]);
});

test("category and product lists need approval; blocked wins over allowed", () => {
  const product = { vendorName: "Arla Oy", category: "MILK", allergens: [], co2PerKg: null, deliveryReliability: null };
  const blocked = evaluatePolicy(autonomous({ blockedCategories: ["milk"] }), [line({ product })]);
  assert.deepEqual(codes(blocked), ["CATEGORY_BLOCKED"]);
  const outside = evaluatePolicy(autonomous({ allowedCategories: ["CHEESE"] }), [line({ product })]);
  assert.deepEqual(codes(outside), ["CATEGORY_NOT_ALLOWED"]);
  const inside = evaluatePolicy(autonomous({ allowedCategories: ["MILK"] }), [line({ product })]);
  assert.equal(inside.outcome, "ALLOW");
  const productBlocked = evaluatePolicy(autonomous({ blockedProductIds: ["469330"], allowedProductIds: ["469330"] }), [line({ product })]);
  assert.deepEqual(codes(productBlocked), ["PRODUCT_BLOCKED"]);
  const notListed = evaluatePolicy(autonomous({ allowedProductIds: ["1"] }), [line({ product })]);
  assert.deepEqual(codes(notListed), ["PRODUCT_NOT_ALLOWED"]);
});

// ----- Substitutes and "may contain" -----
test("substitutes need approval unless allowSubstitutes", () => {
  const sub = { requested: "lactose-free milk", reason: "split" as const };
  const blocked = evaluatePolicy(autonomous(), [line({ substituteFor: sub })]);
  assert.equal(blocked.outcome, "REQUIRE_APPROVAL");
  assert.deepEqual(codes(blocked), ["SUBSTITUTE_NOT_ALLOWED"]);
  assert.match(blocked.reasons[0]!.message, /short-stock split/);
  const allowed = evaluatePolicy(autonomous({ allowSubstitutes: true }), [line({ substituteFor: sub })]);
  assert.equal(allowed.outcome, "ALLOW");
});

test("a 'may contain' excluded allergen needs approval, 'contains' denies", () => {
  const product = { vendorName: "X", allergens: [], mayContainAllergens: ["SA"], co2PerKg: null, deliveryReliability: null };
  const r = evaluatePolicy(autonomous({ excludedAllergens: ["tree-nuts"] }), [line({ product })]);
  assert.equal(r.outcome, "REQUIRE_APPROVAL");
  assert.deepEqual(codes(r), ["MAY_CONTAIN_EXCLUDED_ALLERGEN"]);
});
