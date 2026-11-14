import "server-only";

import type { PolicyOutcome, PolicyReason } from "@/shared/contracts/policy";
import type { Preferences } from "@/shared/contracts/preferences";

// The policy rules, as a pure function: no database, no network. Applies the buyer's effective
// preferences to known facts about a draft order. Missing data (no CO2, no allergen list, no
// reliability) never triggers a rule here: what to do about it is the agent's decision.
// Type-only imports, so `pnpm test:server` (plain Node) can run it.

export type PolicyProductFacts = {
  vendorName: string;
  allergens: string[];
  co2PerKg: number | null;
  deliveryReliability: number | null;
};

export type PolicyLineFacts = {
  productId: string;
  quantity: number;
  /** Null: not in the catalog. */
  product: PolicyProductFacts | null;
  /** EUR excl. VAT per sales unit. Null: Valio has no price. */
  unitPriceExclVat: number | null;
  /** The unit the price and quantity are in (e.g. KI). */
  salesUnit?: string | null;
  /** Valio's availability for the requested date. Null: Valio gave no answer. Absent: not checked. */
  availability?: PolicyAvailabilityFacts | null;
};

export type PolicyAvailabilityFacts = {
  orderable: boolean;
  salesBlock: boolean;
  /** Earliest delivery date (YYYY-MM-DD…); may be later than requested. */
  availableDate: string | null;
  /** Null: unknown (terminal products) or nothing available. */
  availableQuantity: number | null;
  salesUnit: string | null;
};

export type PolicyOptions = {
  /** The delivery date the goods are needed (YYYY-MM-DD). */
  requestedDate?: string;
};

export type PolicyResult = {
  outcome: PolicyOutcome;
  reasons: PolicyReason[];
  /** Null when any line has no price or product. */
  totalExclVat: number | null;
};

const RANK: Record<PolicyOutcome, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };
const eur = (n: number) => `€${n.toFixed(2)}`;
const round = (n: number) => Math.round(n * 100) / 100;

export function lineTotal(line: PolicyLineFacts): number | null {
  return line.product && line.unitPriceExclVat !== null ? round(line.unitPriceExclVat * line.quantity) : null;
}

export function evaluatePolicy(prefs: Preferences, lines: PolicyLineFacts[], options: PolicyOptions = {}): PolicyResult {
  const reasons: PolicyReason[] = [];
  const deny = (r: Omit<PolicyReason, "outcome">) => reasons.push({ ...r, outcome: "DENY" });
  const approve = (r: Omit<PolicyReason, "outcome">) => reasons.push({ ...r, outcome: "REQUIRE_APPROVAL" });

  // ----- Per product -----
  const blockedVendors = new Set(prefs.blockedVendors);
  const excluded = new Set(prefs.excludedAllergens);
  for (const line of lines) {
    const { product, productId } = line;
    if (!product) {
      deny({ code: "UNKNOWN_PRODUCT", productId, message: `Product ${productId} is not in the catalog.` });
      continue;
    }
    if (line.unitPriceExclVat === null)
      deny({ code: "PRICE_UNKNOWN", productId, message: `No price for product ${productId}, so the order total can't be checked.` });
    if (blockedVendors.has(product.vendorName))
      deny({ code: "BLOCKED_VENDOR", setting: "blockedVendors", productId, message: `Vendor ${product.vendorName} is blocked.` });
    const found = product.allergens.filter((a) => excluded.has(a));
    if (found.length)
      deny({ code: "EXCLUDED_ALLERGEN", setting: "excludedAllergens", productId, message: `Contains excluded allergens: ${found.join(", ")}.` });
    if (prefs.maxCo2PerKg !== null && product.co2PerKg !== null && product.co2PerKg > prefs.maxCo2PerKg)
      deny({
        code: "CO2_TOO_HIGH",
        setting: "maxCo2PerKg",
        productId,
        message: `${product.co2PerKg} kg CO2-eq/kg is above the limit of ${prefs.maxCo2PerKg}.`,
      });
    if (
      prefs.minDeliveryReliability !== null &&
      product.deliveryReliability !== null &&
      product.deliveryReliability < prefs.minDeliveryReliability
    )
      deny({
        code: "RELIABILITY_TOO_LOW",
        setting: "minDeliveryReliability",
        productId,
        message: `Delivery reliability ${product.deliveryReliability} is below the minimum of ${prefs.minDeliveryReliability}.`,
      });
  }

  // ----- Availability on the requested date -----
  for (const line of lines) {
    const { productId, availability } = line;
    if (!line.product || availability === undefined) continue;
    if (availability === null) {
      approve({
        code: "AVAILABILITY_UNKNOWN",
        productId,
        message: `Valio gave no availability for product ${productId}, so delivery can't be confirmed.`,
      });
      continue;
    }
    if (availability.salesBlock) {
      deny({ code: "SALES_BLOCKED", productId, message: `Product ${productId} is blocked from sale.` });
      continue;
    }
    if (!availability.orderable) {
      deny({ code: "NOT_ORDERABLE", productId, message: `Product ${productId} can't be delivered on any date.` });
      continue;
    }
    const earliest = availability.availableDate?.slice(0, 10) ?? null;
    if (options.requestedDate && earliest && earliest > options.requestedDate)
      approve({
        code: "LATE_DELIVERY",
        productId,
        message: `Product ${productId} can be delivered on ${earliest} at the earliest, after the requested ${options.requestedDate}.`,
      });
    const sameUnit = !line.salesUnit || !availability.salesUnit || line.salesUnit === availability.salesUnit;
    if (availability.availableQuantity !== null && sameUnit && availability.availableQuantity < line.quantity)
      approve({
        code: "INSUFFICIENT_STOCK",
        productId,
        message: `Only ${availability.availableQuantity}${availability.salesUnit ? ` ${availability.salesUnit}` : ""} of product ${productId} available, ${line.quantity} requested.`,
      });
  }

  // ----- Order total -----
  const totals = lines.map(lineTotal);
  const totalExclVat = totals.every((t) => t !== null) ? round(totals.reduce((s, t) => s + t!, 0)) : null;
  if (totalExclVat !== null && prefs.maxOrderValue !== null && totalExclVat > prefs.maxOrderValue)
    deny({
      code: "ORDER_VALUE_TOO_HIGH",
      setting: "maxOrderValue",
      message: `The total of ${eur(totalExclVat)} is above the maximum order value of ${eur(prefs.maxOrderValue)}.`,
    });

  // ----- Approval -----
  if (prefs.autonomy === "suggest_only")
    approve({ code: "SUGGEST_ONLY", setting: "autonomy", message: "The agent may only suggest orders; an approver must decide." });
  if (prefs.autoApproveBelow === null)
    approve({ code: "NO_AUTO_APPROVAL", setting: "autoApproveBelow", message: "Every order needs an approver." });
  else if (totalExclVat !== null && totalExclVat >= prefs.autoApproveBelow)
    approve({
      code: "ABOVE_AUTO_APPROVAL",
      setting: "autoApproveBelow",
      message: `The total of ${eur(totalExclVat)} is not below the auto-approval limit of ${eur(prefs.autoApproveBelow)}.`,
    });

  const outcome = reasons.reduce<PolicyOutcome>((worst, r) => (RANK[r.outcome] > RANK[worst] ? r.outcome : worst), "ALLOW");
  if (outcome === "ALLOW")
    reasons.push({
      code: "WITHIN_LIMITS",
      outcome: "ALLOW",
      message: `The total of ${eur(totalExclVat!)} is within the limits; no approval needed.`,
    });
  return { outcome, reasons, totalExclVat };
}
