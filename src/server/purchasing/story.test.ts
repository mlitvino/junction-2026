// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  makeStep,
  revisionsOf,
  stepNumber,
  storySteps,
  withPricingSteps,
  type PricedProposal,
} from "./story.ts";

const priced = (outcome: "ALLOW" | "REQUIRE_APPROVAL" | "DENY", total: number | null = 120): PricedProposal => ({
  id: "p-1",
  status: outcome === "DENY" ? "BLOCKED" : "READY",
  hash: "abc",
  lineCount: 2,
  totalExclVat: total,
  currency: "EUR",
  pricingDate: "2026-11-16",
  decision: {
    outcome,
    reasons: outcome === "ALLOW" ? [{ outcome: "ALLOW", message: "Within limits." }] : [{ outcome, message: "Over the limit." }],
    limits: { maxOrderValue: 100, autoApproveBelow: 50, autonomy: "suggest_only" },
  },
});

test("step numbers follow the two user stories", () => {
  assert.deepEqual(
    storySteps("simple_buy").map((s) => s.key),
    ["extract", "search_by_type", "sort_by_name", "filter_preferences", "sort_by_history", "compare_budget", "create_order", "approval_or_change", "checkout_receipt"],
  );
  assert.equal(storySteps("recipe_order").length, 11);
  assert.equal(stepNumber("simple_buy", "compare_budget"), 6);
  assert.equal(stepNumber("recipe_order", "compare_budget"), 8);
  assert.equal(stepNumber("recipe_order", "subtract_inventory"), 3);
  assert.equal(stepNumber("recipe_order", "checkout_receipt"), 11);
  assert.throws(() => stepNumber("simple_buy", "read_recipe"));
});

test("pricing steps compare the total with the budget and say what happens next", () => {
  const early = [makeStep("simple_buy", "extract", { status: "done", summary: "x" })];

  const allow = withPricingSteps("simple_buy", early, priced("ALLOW", 40));
  assert.deepEqual(allow.map((s) => s.step), [1, 6, 7, 8, 9]);
  assert.equal(allow[1]!.status, "done");
  assert.equal(allow[1]!.details?.withinBudget, true);
  assert.equal(allow[3]!.details?.next, "order");

  const approval = withPricingSteps("simple_buy", early, priced("REQUIRE_APPROVAL", 120));
  assert.equal(approval[1]!.status, "warning");
  assert.equal(approval[1]!.details?.withinBudget, false);
  assert.equal(approval[3]!.details?.next, "send_for_approval");

  const denied = withPricingSteps("simple_buy", early, priced("DENY", null));
  assert.equal(denied[1]!.status, "blocked");
  assert.equal(denied[1]!.details?.withinBudget, null);
  assert.equal(denied[2]!.status, "blocked");
  assert.equal(denied[4]!.status, "blocked");
});

test("a revision replaces the pricing steps, keeps the early ones and accumulates the changes", () => {
  const early = [makeStep("recipe_order", "read_recipe", { status: "done", summary: "r" })];
  const first = withPricingSteps("recipe_order", early, priced("ALLOW"));
  const second = withPricingSteps("recipe_order", first, priced("ALLOW", 90), [
    ...revisionsOf(first),
    { previousProposalId: "p-0", appliedChanges: ["Replaced milk with oat drink."] },
  ]);
  assert.equal(second.filter((s) => s.key === "compare_budget").length, 1);
  assert.equal(second[0]!.key, "read_recipe");
  assert.match(second.find((s) => s.key === "approval_or_change")!.summary, /Replaced milk with oat drink/);
  assert.equal(revisionsOf(second).length, 1);
});
