import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { ProposalSchema } from "@/shared/contracts/purchasing";
import { ProductSearchResponseSchema } from "@/shared/contracts/products";
import { PolicyDecisionSchema } from "@/shared/contracts/policy";
import { ok } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import {
  deliveryDate,
  newOrg,
  orderableProducts,
  RUN,
  setLayer,
  type Org,
} from "./lib/fixtures.ts";

describe("purchasing policy governance", () => {
  let org: Org;
  const date = deliveryDate();
  // Each scenario needs its own spending history and preferences.
  beforeEach(async () => {
    org = await newOrg("gov");
  });
  after(() => cleanup(RUN));

  it("exact matches need an approved first purchase; only preferred fallback substitutions are automatic", async () => {
    const products = ok(
      await org.buyer.get("/api/products?q=lactose-free%20milk&limit=40"),
      200,
      ProductSearchResponseSchema,
      "branded products",
    );
    const product = products.items.find((p) => p.brand && p.vendorName);
    assert.ok(product, "a milk product with declared brand and supplier");
    const settings = {
      autonomy: "order_within_limits" as const,
      autoApproveBelow: 100000,
      maxOrderValue: 100000,
      dailySpendingCap: null,
      exactMatchOnly: true,
      softBudgetTolerance: true,
      allowSubstitutes: true,
      preferenceOnlySubstitutions: true,
      preferredBrands: [product.brand!],
    };
    await setLayer(org.owner, "base", settings);
    const draft = { lines: [{ productId: product.id, quantity: 1 }], date };
    const proposal = ok(
      await org.buyer.post("/api/proposals", draft),
      201,
      ProposalSchema,
      "first exact purchase",
    );
    assert.ok(proposal.decision.reasons.some((r) => r.code === "EXACT_MATCH_REQUIRED"));
    const pending = ok(
      await org.buyer.post(`/api/proposals/${proposal.id}/approval`, {}),
      200,
      ProposalSchema,
      "request approval",
    );
    const approved = await org.approver.post(`/api/approvals/${pending.approval!.id}/decision`, {
      decision: "APPROVED",
      proposalHash: proposal.hash,
    });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    const ordered = await org.buyer.post(`/api/proposals/${proposal.id}/order`, {
      idempotencyKey: `first-${proposal.id}`,
    });
    assert.equal(ordered.status, 201, JSON.stringify(ordered));
    const repeated = ok(
      await org.buyer.post("/api/policy/evaluate", draft),
      200,
      PolicyDecisionSchema,
      "recurring exact purchase",
    );
    assert.equal(repeated.outcome, "ALLOW", JSON.stringify(repeated.reasons));
    const substitute = (reason: "fallback" | "swap") => ({
      ...draft,
      lines: [{ ...draft.lines[0]!, substituteFor: { requested: "unavailable milk", reason } }],
    });
    const fallback = ok(
      await org.buyer.post("/api/policy/evaluate", substitute("fallback")),
      200,
      PolicyDecisionSchema,
      "preferred fallback",
    );
    assert.equal(fallback.outcome, "ALLOW", JSON.stringify(fallback.reasons));
    const swap = ok(
      await org.buyer.post("/api/policy/evaluate", substitute("swap")),
      200,
      PolicyDecisionSchema,
      "manual swap",
    );
    assert.equal(swap.outcome, "REQUIRE_APPROVAL");
    if (product.allergens.length) {
      await setLayer(org.owner, "base", {
        ...settings,
        excludedAllergens: [product.allergens[0]!],
      });
      const unsafe = ok(
        await org.buyer.post("/api/policy/evaluate", substitute("fallback")),
        200,
        PolicyDecisionSchema,
        "safety still applies",
      );
      assert.equal(unsafe.outcome, "DENY");
    }
  });

  it("a rolling organization cap is atomic across concurrent orders and idempotent replays", async () => {
    const [product] = await orderableProducts(org.buyer, date, 1);
    const draft = { lines: [{ productId: product!.id, quantity: 1 }], date };
    const preview = ok(
      await org.buyer.post("/api/policy/evaluate", draft),
      200,
      PolicyDecisionSchema,
      "preview",
    );
    const total = preview.totalExclVat!;
    assert.ok(total > 0);
    await setLayer(org.owner, "base", {
      autonomy: "order_within_limits",
      autoApproveBelow: total * 10,
      maxOrderValue: total * 20,
      dailySpendingCap: Math.round(total * 150) / 100,
    });
    const first = ok(
      await org.buyer.post("/api/proposals", draft),
      201,
      ProposalSchema,
      "first proposal",
    );
    const second = ok(
      await org.buyer.post("/api/proposals", draft),
      201,
      ProposalSchema,
      "second proposal",
    );
    assert.equal(first.decision.outcome, "ALLOW", JSON.stringify(first.decision.reasons));
    assert.equal(second.decision.outcome, "ALLOW", JSON.stringify(second.decision.reasons));
    const attempts = await Promise.all(
      [first, second].map((p) =>
        org.buyer.post(`/api/proposals/${p.id}/order`, { idempotencyKey: `gov-${p.id}` }),
      ),
    );
    assert.equal(attempts.filter((r) => r.status === 201).length, 1, JSON.stringify(attempts));
    const refused = attempts.find((r) => r.status !== 201)!;
    assert.equal((refused.body as { code: string }).code, "DAILY_SPENDING_CAP");
    const winner = [first, second][attempts.findIndex((r) => r.status === 201)]!;
    const replay = await org.buyer.post(`/api/proposals/${winner.id}/order`, {
      idempotencyKey: `gov-${winner.id}`,
    });
    assert.equal(replay.status, 200);
    const next = ok(
      await org.buyer.post("/api/policy/evaluate", draft),
      200,
      PolicyDecisionSchema,
      "cap preview",
    );
    assert.equal(next.outcome, "DENY");
    assert.ok(next.reasons.some((r) => r.code === "DAILY_SPENDING_CAP"));
  });
});
