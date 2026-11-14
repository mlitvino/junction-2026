// Scenario 6: the organization's rules decide — ALLOW orders without approval, DENY blocks, and
// specific rules (allergens, substitutes) give their own reasons.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PolicyDecisionSchema } from "@/shared/contracts/policy";
import { OrderSchema, ProposalSchema, type Proposal } from "@/shared/contracts/purchasing";

import { expectError, ok } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { deliveryDate, newOrg, orderableProducts, RUN, setLayer, type Org, type Pick } from "./lib/fixtures.ts";

describe("policy outcomes", () => {
  let org: Org;
  let products: Pick[];
  const date = deliveryDate();

  before(async () => {
    org = await newOrg("pol");
    products = await orderableProducts(org.buyer, date);
  });
  after(() => cleanup(RUN));

  const propose = async (lines: unknown[]): Promise<Proposal> =>
    ok(await org.buyer.post("/api/proposals", { lines, date }), 201, ProposalSchema, "create proposal");
  const codes = (p: Proposal) => p.decision.reasons.map((r) => r.code);

  it("within the auto-approval limit and with autonomy, a proposal is ordered directly", async () => {
    await setLayer(org.approver, "base", { autonomy: "order_within_limits", autoApproveBelow: 100_000, maxOrderValue: 200_000 });
    const p = await propose([{ productId: products[0]!.id, quantity: 1 }]);
    assert.equal(p.decision.outcome, "ALLOW", `reasons: ${codes(p).join(", ")}`);
    assert.ok(codes(p).includes("WITHIN_LIMITS"));
    expectError(await org.buyer.post(`/api/proposals/${p.id}/approval`), 422, "APPROVAL_NOT_NEEDED", "send an allowed proposal");
    const order = ok(await org.buyer.post(`/api/proposals/${p.id}/order`, { idempotencyKey: `${RUN}-allow` }), 201, OrderSchema, "order");
    assert.equal(order.proposalHash, p.hash);
  });

  it("the policy preview gives the same decision without storing anything", async () => {
    const d = ok(
      await org.buyer.post("/api/policy/evaluate", { lines: [{ productId: products[0]!.id, quantity: 1 }], date }),
      200,
      PolicyDecisionSchema,
      "evaluate",
    );
    assert.equal(d.outcome, "ALLOW");
    assert.ok(d.lines[0]!.priceSnapshotId, "the preview names its price snapshot");
  });

  it("above the max order value: DENY, the proposal is BLOCKED for good", async () => {
    await setLayer(org.approver, "base", { maxOrderValue: 0.01 });
    const p = await propose([{ productId: products[0]!.id, quantity: 1 }]);
    assert.equal(p.decision.outcome, "DENY");
    assert.equal(p.status, "BLOCKED");
    assert.ok(codes(p).includes("ORDER_VALUE_TOO_HIGH"), codes(p).join(", "));
    expectError(await org.buyer.post(`/api/proposals/${p.id}/approval`), 422, "BLOCKED_BY_POLICY", "send a blocked proposal");
    expectError(
      await org.buyer.post(`/api/proposals/${p.id}/order`, { idempotencyKey: `${RUN}-deny` }),
      422,
      "BLOCKED_BY_POLICY",
      "order a blocked proposal",
    );
  });

  it("a product that contains an excluded allergen is denied", async (t) => {
    const milk = products.find((p) => p.allergens.includes("ML"));
    if (!milk) return t.skip("no orderable product that contains milk");
    await setLayer(org.approver, "base", { excludedAllergens: ["milk"] });
    const p = await propose([{ productId: milk.id, quantity: 1 }]);
    assert.equal(p.decision.outcome, "DENY");
    const reason = p.decision.reasons.find((r) => r.code === "EXCLUDED_ALLERGEN");
    assert.ok(reason, codes(p).join(", "));
    assert.equal(reason.productId, milk.id);
    assert.equal(reason.setting, "excludedAllergens");
  });

  it("a substitute line needs approval while substitutes aren't allowed", async () => {
    await setLayer(org.approver, "base", { autonomy: "order_within_limits", autoApproveBelow: 100_000 });
    const p = await propose([
      { productId: products[0]!.id, quantity: 1, substituteFor: { requested: "oat milk", reason: "swap" } },
    ]);
    assert.ok(codes(p).includes("SUBSTITUTE_NOT_ALLOWED"), codes(p).join(", "));
    assert.equal(p.decision.outcome, "REQUIRE_APPROVAL");
    assert.deepEqual(p.lines[0]!.substituteFor, { requested: "oat milk", reason: "swap" });

    await setLayer(org.approver, "base", { autonomy: "order_within_limits", autoApproveBelow: 100_000, allowSubstitutes: true });
    const allowed = await propose([
      { productId: products[0]!.id, quantity: 1, substituteFor: { requested: "oat milk", reason: "swap" } },
    ]);
    assert.ok(!codes(allowed).includes("SUBSTITUTE_NOT_ALLOWED"));
    assert.equal(allowed.decision.outcome, "ALLOW");
  });
});
