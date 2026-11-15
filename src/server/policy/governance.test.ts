import "server-only";

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PREFERENCES } from "../services/preferences.ts";
import { governanceReasons, type GovernanceLine } from "./governance.ts";

const line: GovernanceLine = {
  productId: "milk",
  brand: "Valio",
  vendorName: "Valio Oy",
  unitPriceExclVat: 10,
};
const prefs = { ...DEFAULT_PREFERENCES, exactMatchOnly: true };

test("exact match needs recorded item, brand and supplier; missing metadata needs approval", () => {
  assert.equal(governanceReasons(prefs, [line], 10, 0, [line]).length, 0);
  for (const previous of [
    [],
    [{ ...line, brand: null }],
    [{ ...line, vendorName: "Other" }],
    [{ ...line, productId: "other" }],
  ]) {
    assert.equal(
      governanceReasons(prefs, [line], 10, 0, previous)[0]?.code,
      "EXACT_MATCH_REQUIRED",
    );
  }
});

test("5% tolerance accepts the boundary, rejects above it, and never bypasses daily spending", () => {
  assert.equal(
    governanceReasons(prefs, [{ ...line, unitPriceExclVat: 10.01 }], 10.01, 0, [line])[0]?.code,
    "RECURRING_PRICE_INCREASE",
  );
  const tolerant = { ...prefs, softBudgetTolerance: true };
  assert.equal(
    governanceReasons(tolerant, [{ ...line, unitPriceExclVat: 10.5 }], 10.5, 0, [line]).length,
    0,
  );
  assert.equal(
    governanceReasons(tolerant, [{ ...line, unitPriceExclVat: 10.51 }], 10.51, 0, [line])[0]?.code,
    "RECURRING_PRICE_INCREASE",
  );
  assert.equal(
    governanceReasons({ ...tolerant, dailySpendingCap: 20 }, [line], 10, 10.01, [line])[0]?.outcome,
    "DENY",
  );
  assert.equal(
    governanceReasons({ ...tolerant, dailySpendingCap: 20 }, [line], 10, 10, [line]).length,
    0,
  );
});

test("substitutions require an explicitly approved brand and permission", () => {
  const substitute = { ...line, substituteFor: { requested: "other", reason: "fallback" } };
  const approved = {
    ...prefs,
    preferenceOnlySubstitutions: true,
    allowSubstitutes: true,
    preferredBrands: ["Valio"],
  };
  assert.equal(governanceReasons(approved, [substitute], 10, 0, []).length, 0);
  assert.ok(
    governanceReasons({ ...approved, preferredBrands: [] }, [substitute], 10, 0, []).some(
      (r) => r.code === "SUBSTITUTION_PREFERENCE_REQUIRED",
    ),
  );
  assert.ok(
    governanceReasons({ ...approved, allowSubstitutes: false }, [substitute], 10, 0, []).some(
      (r) => r.code === "EXACT_MATCH_REQUIRED",
    ),
  );
});

test("last purchase is the reference and signed quote rules remain separate", () => {
  assert.equal(
    governanceReasons(prefs, [line], 10, 0, [line, { ...line, unitPriceExclVat: 1 }]).length,
    0,
  );
});
