import "server-only";

import type { Preferences } from "@/shared/contracts/preferences";
import type { PolicyReason } from "@/shared/contracts/policy";

export type GovernanceLine = {
  productId: string;
  vendorName: string;
  brand?: string | null;
  unitPriceExclVat: number | null;
  substituteFor?: { requested: string; reason: string } | null;
};

/** Compares newly quoted prices with the last purchase; never changes a signed quote. */
export function governanceReasons(
  prefs: Preferences,
  lines: GovernanceLine[],
  total: number | null,
  spent: number,
  previous: GovernanceLine[],
): PolicyReason[] {
  const reasons: PolicyReason[] = [];
  if (
    prefs.dailySpendingCap != null &&
    total !== null &&
    Math.round((spent + total) * 100) > Math.round(prefs.dailySpendingCap * 100)
  ) {
    reasons.push({
      code: "DAILY_SPENDING_CAP",
      setting: "dailySpendingCap",
      outcome: "DENY",
      message: `Rolling 24-hour spending (€${spent.toFixed(2)}) plus this purchase exceeds the €${prefs.dailySpendingCap.toFixed(2)} daily cap.`,
    });
  }
  for (const line of lines) {
    const prior = previous.find((p) => p.productId === line.productId);
    const exact =
      !!prior &&
      !!line.brand &&
      prior.brand === line.brand &&
      !!line.vendorName &&
      prior.vendorName === line.vendorName &&
      !line.substituteFor;
    const preferredSubstitute =
      !!line.substituteFor &&
      ["fallback", "split"].includes(line.substituteFor.reason) &&
      prefs.allowSubstitutes &&
      prefs.preferenceOnlySubstitutions &&
      !!line.brand &&
      prefs.preferredBrands.includes(line.brand);
    if (prefs.exactMatchOnly && !exact && !preferredSubstitute) {
      reasons.push({
        code: "EXACT_MATCH_REQUIRED",
        setting: "exactMatchOnly",
        outcome: "REQUIRE_APPROVAL",
        productId: line.productId,
        message:
          "Automatic purchasing requires a previously ordered item with the same verified brand and supplier.",
      });
    }
    if (line.substituteFor && prefs.preferenceOnlySubstitutions && !preferredSubstitute) {
      reasons.push({
        code: "SUBSTITUTION_PREFERENCE_REQUIRED",
        setting: "preferenceOnlySubstitutions",
        outcome: "REQUIRE_APPROVAL",
        productId: line.productId,
        message:
          "This substitute is not from an approved preferred brand and requires human approval.",
      });
    }
    if (
      prefs.exactMatchOnly &&
      exact &&
      prior.unitPriceExclVat !== null &&
      line.unitPriceExclVat !== null
    ) {
      const limit = prior.unitPriceExclVat * (prefs.softBudgetTolerance ? 1.05 : 1);
      if (Math.round(line.unitPriceExclVat * 10000) > Math.round(limit * 10000))
        reasons.push({
          code: "RECURRING_PRICE_INCREASE",
          setting: "softBudgetTolerance",
          outcome: "REQUIRE_APPROVAL",
          productId: line.productId,
          message: `The price increase exceeds the ${prefs.softBudgetTolerance ? "5%" : "0%"} tolerance against the last purchase.`,
        });
    }
  }
  return reasons;
}
