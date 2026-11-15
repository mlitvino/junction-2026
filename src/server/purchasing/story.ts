import "server-only";

import type { PolicyOutcome, PolicyReason } from "@/shared/contracts/policy";
import type { StoryStep } from "@/shared/contracts/selection";

// The agent's story as numbered steps, the same in the backend trace and in the UI. Pure functions
// (no database; type-only imports), so `pnpm test:server` can run them.
//
//   simple_buy:   1 extract · 2 search by type · 3 sort by name · 4 filter by preferences ·
//                 5 sort by history · 6 compare with budget · 7 create order · 8 approval or change ·
//                 9 checkout + receipt
//   recipe_order: 1 read recipe · 2 total quantity · 3 minus inventory stock · 4-11 = simple 2-9

export type StoryKind = StoryStep["story"];
export type StoryKey = StoryStep["key"];

const SIMPLE: { key: StoryKey; title: string }[] = [
  { key: "extract", title: "Extract product, type and quantity from the request" },
  { key: "search_by_type", title: "Find products by product type" },
  { key: "sort_by_name", title: "Sort the products by best match with the requested name" },
  { key: "filter_preferences", title: "Remove products that break the preferences" },
  { key: "sort_by_history", title: "Prefer products and brands ordered before" },
  { key: "compare_budget", title: "Compare the price with the budget" },
  { key: "create_order", title: "Create the order" },
  { key: "approval_or_change", title: "Ask for approval or changes" },
  { key: "checkout_receipt", title: "Check out and give the receipt" },
];

const RECIPE: { key: StoryKey; title: string }[] = [
  { key: "read_recipe", title: "Read the ingredients from the recipe" },
  { key: "total_quantity", title: "Calculate the total quantity of each ingredient" },
  { key: "subtract_inventory", title: "Subtract the inventory stock: what is actually needed" },
  ...SIMPLE.slice(1),
];

const STORIES: Record<StoryKind, { key: StoryKey; title: string }[]> = { simple_buy: SIMPLE, recipe_order: RECIPE };

/** The ordered steps of a story. */
export function storySteps(story: StoryKind): readonly { step: number; key: StoryKey; title: string }[] {
  return STORIES[story].map((s, i) => ({ ...s, step: i + 1 }));
}

/** A step's number in its story (e.g. `compare_budget` is 6 in `simple_buy`, 9 in `recipe_order`). */
export function stepNumber(story: StoryKind, key: StoryKey): number {
  const i = STORIES[story].findIndex((s) => s.key === key);
  if (i < 0) throw new Error(`Step ${key} is not part of ${story}`);
  return i + 1;
}

export function makeStep(
  story: StoryKind,
  key: StoryKey,
  fields: { status: StoryStep["status"]; summary: string; item?: string | null; details?: Record<string, unknown> },
): StoryStep {
  const found = STORIES[story].find((s) => s.key === key);
  if (!found) throw new Error(`Step ${key} is not part of ${story}`);
  return {
    story,
    step: stepNumber(story, key),
    key,
    title: found.title,
    item: fields.item ?? null,
    status: fields.status,
    summary: fields.summary,
    ...(fields.details ? { details: fields.details } : {}),
  };
}

/** Marks an audit entry's details with the step it belongs to. */
export function stepDetails(story: StoryKind, key: StoryKey, details: Record<string, unknown> = {}) {
  return { ...details, story, step: stepNumber(story, key), stepKey: key };
}

/** The proposal's frozen pricing, as far as the later steps need it. */
export type PricedProposal = {
  id: string;
  status: string;
  hash: string;
  lineCount: number;
  totalExclVat: number | null;
  currency: string;
  pricingDate: string;
  decision: {
    outcome: PolicyOutcome;
    reasons: Pick<PolicyReason, "outcome" | "message">[];
    limits: { maxOrderValue: number | null; autoApproveBelow: number | null; autonomy: string };
  };
};

const eur = (n: number | null) => (n === null ? "unknown" : `€${n.toFixed(2)}`);

/** Step "compare the price with the budget": total against the organization's limits. */
export function budgetStep(story: StoryKind, p: PricedProposal): StoryStep {
  const { maxOrderValue, autoApproveBelow } = p.decision.limits;
  const total = p.totalExclVat;
  const withinBudget = maxOrderValue === null ? true : total === null ? null : total <= maxOrderValue;
  const limit = maxOrderValue === null ? "no maximum order value" : `maximum order value ${eur(maxOrderValue)}`;
  const concerns = p.decision.reasons.filter((r) => r.outcome !== "ALLOW").map((r) => r.message);
  const status: StoryStep["status"] =
    p.decision.outcome === "DENY" ? "blocked" : p.decision.outcome === "REQUIRE_APPROVAL" ? "warning" : "done";
  const verdict =
    p.decision.outcome === "ALLOW"
      ? "within the organization's limits"
      : p.decision.outcome === "DENY"
        ? "refused by the organization's rules"
        : "needs an approver";
  return makeStep(story, "compare_budget", {
    status,
    summary:
      `Total ${eur(total)} excl. VAT against ${limit}` +
      `${autoApproveBelow === null ? "" : ` (auto-approved below ${eur(autoApproveBelow)})`}: ${verdict}.` +
      `${concerns.length ? ` ${concerns.join(" ")}` : ""}`,
    details: {
      totalExclVat: total,
      currency: p.currency,
      maxOrderValue,
      autoApproveBelow,
      withinBudget,
      outcome: p.decision.outcome,
      reasons: concerns,
    },
  });
}

/** Step "create the order": the frozen proposal. */
export function createOrderStep(story: StoryKind, p: PricedProposal): StoryStep {
  return makeStep(story, "create_order", {
    status: p.decision.outcome === "DENY" ? "blocked" : "done",
    summary:
      `Created proposal ${p.id} with ${p.lineCount} line(s), ${eur(p.totalExclVat)} excl. VAT for ${p.pricingDate}; ` +
      `status ${p.status}.`,
    details: { proposalId: p.id, status: p.status, hash: p.hash, totalExclVat: p.totalExclVat, pricingDate: p.pricingDate },
  });
}

/** What can happen to a revision: kept in step 8's details so the UI can list the changes. */
export type Revision = { previousProposalId: string; appliedChanges: string[] };

/** Step "ask for approval or changes": what the buyer does next (the live state is the proposal's own). */
export function approvalStep(story: StoryKind, p: PricedProposal, revisions: Revision[] = []): StoryStep {
  const { outcome } = p.decision;
  const next =
    outcome === "DENY"
      ? "revise"
      : outcome === "REQUIRE_APPROVAL"
        ? "send_for_approval"
        : "order";
  const instruction =
    outcome === "DENY"
      ? "The rules block this proposal: ask for changes (POST /api/proposals/{id}/revise) or make a new request."
      : outcome === "REQUIRE_APPROVAL"
        ? "Send it to an approver (POST /api/proposals/{id}/approval), or ask for changes (POST /api/proposals/{id}/revise)."
        : "No approval needed: order it (POST /api/proposals/{id}/order), or ask for changes (POST /api/proposals/{id}/revise).";
  const changed = revisions.length
    ? `Changed on request: ${revisions.flatMap((r) => r.appliedChanges).join(" ")} `
    : "";
  return makeStep(story, "approval_or_change", {
    status: outcome === "DENY" ? "blocked" : "pending",
    summary: `${changed}${instruction}`,
    details: { next, proposalId: p.id, revisions },
  });
}

/** Step "check out and give the receipt": pending until the order exists. */
export function checkoutStep(story: StoryKind, p: PricedProposal): StoryStep {
  return makeStep(story, "checkout_receipt", {
    status: p.decision.outcome === "DENY" ? "blocked" : "pending",
    summary:
      p.decision.outcome === "DENY"
        ? "Nothing to check out: the proposal is blocked."
        : "Order with POST /api/proposals/{id}/order, then read the receipt with GET /api/orders/{id}/receipt.",
    details: { proposalId: p.id },
  });
}

const LATER_KEYS: StoryKey[] = ["compare_budget", "create_order", "approval_or_change", "checkout_receipt"];

/**
 * The steps for a proposal that was just priced: the recorded early steps (extract … history) kept,
 * and steps compare-budget to checkout (re)written from this proposal. Used when the agent creates
 * a proposal and again when a revision creates the next one.
 */
export function withPricingSteps(
  story: StoryKind,
  steps: readonly StoryStep[],
  priced: PricedProposal,
  revisions: Revision[] = [],
): StoryStep[] {
  const early = steps.filter((s) => s.story === story && !LATER_KEYS.includes(s.key));
  return [
    ...early,
    budgetStep(story, priced),
    createOrderStep(story, priced),
    approvalStep(story, priced, revisions),
    checkoutStep(story, priced),
  ];
}

/** Revisions already recorded in a step list (so the next revision adds to them). */
export function revisionsOf(steps: readonly StoryStep[] | undefined): Revision[] {
  const found = steps?.find((s) => s.key === "approval_or_change")?.details?.revisions;
  return Array.isArray(found) ? (found as Revision[]) : [];
}
