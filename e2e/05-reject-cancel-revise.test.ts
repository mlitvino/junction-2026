// Scenario 5: the other ways a proposal ends — rejected, cancelled, or replaced by a revision.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  AuditListSchema,
  ProposalSchema,
  ReviseProposalResponseSchema,
  type Proposal,
} from "@/shared/contracts/purchasing";

import { expectError, expectStatus, ok } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { deliveryDate, newOrg, orderableProducts, RUN, setLayer, type Org, type Pick } from "./lib/fixtures.ts";

describe("reject, cancel, revise", () => {
  let org: Org;
  let products: Pick[];
  const date = deliveryDate();

  before(async () => {
    org = await newOrg("rcr");
    products = await orderableProducts(org.buyer, date);
  });
  after(() => cleanup(RUN));

  const create = async (quantity = 1): Promise<Proposal> =>
    ok(
      await org.buyer.post("/api/proposals", { lines: [{ productId: products[0]!.id, quantity }], date }),
      201,
      ProposalSchema,
      "create proposal",
    );

  it("rejecting needs a comment; a rejected proposal can't be ordered", async () => {
    let p = ok(await org.buyer.post(`/api/proposals/${(await create()).id}/approval`), 200, ProposalSchema, "send");
    const decision = `/api/approvals/${p.approval!.id}/decision`;
    expectStatus(await org.approver.post(decision, { decision: "REJECTED", proposalHash: p.hash }), 400, "reject without comment");

    p = ok(
      await org.approver.post(decision, { decision: "REJECTED", proposalHash: p.hash, comment: "Too expensive this week" }),
      200,
      ProposalSchema,
      "reject",
    );
    assert.equal(p.status, "REJECTED");
    assert.equal(p.approval?.comment, "Too expensive this week");
    expectError(
      await org.buyer.post(`/api/proposals/${p.id}/order`, { idempotencyKey: `${RUN}-rejected` }),
      409,
      "INVALID_STATE",
      "order a rejected proposal",
    );
    expectError(await org.buyer.post(`/api/proposals/${p.id}/cancel`), 409, "INVALID_STATE", "cancel a rejected proposal");
  });

  it("only the creator cancels; a pending approval is withdrawn with it", async () => {
    const created = await create();
    expectError(await org.owner.post(`/api/proposals/${created.id}/cancel`), 403, "NOT_CREATOR", "someone else cancels");

    const sent = ok(await org.buyer.post(`/api/proposals/${created.id}/approval`), 200, ProposalSchema, "send");
    const cancelled = ok(await org.buyer.post(`/api/proposals/${sent.id}/cancel`), 200, ProposalSchema, "cancel");
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.approval?.status, "CANCELLED");
    expectError(
      await org.approver.post(`/api/approvals/${sent.approval!.id}/decision`, { decision: "APPROVED", proposalHash: sent.hash }),
      409,
      "INVALID_STATE",
      "approve a cancelled proposal",
    );
  });

  it("a revision is a new, re-priced proposal; the old one is cancelled", async () => {
    const original = await create(1);
    const r = ok(
      await org.buyer.post(`/api/proposals/${original.id}/revise`, {
        quantityUpdates: [{ productId: products[0]!.id, quantity: 3 }],
        addItems: [{ productId: products[1]!.id, quantity: 1 }],
      }),
      201,
      ReviseProposalResponseSchema,
      "revise",
    );
    assert.equal(r.previousProposalId, original.id);
    assert.equal(r.previousCancelled, true);
    assert.notEqual(r.proposal.id, original.id);
    assert.notEqual(r.proposal.hash, original.hash);
    const lines = new Map(r.proposal.lines.map((l) => [l.productId, l.quantity]));
    assert.equal(lines.get(products[0]!.id), 3);
    assert.equal(lines.get(products[1]!.id), 1);

    const old = ok(await org.buyer.get(`/api/proposals/${original.id}`), 200, ProposalSchema, "old proposal");
    assert.equal(old.status, "CANCELLED");

    const trail = ok(await org.buyer.get(`/api/proposals/${r.proposal.id}/audit`), 200, AuditListSchema, "new proposal audit");
    assert.ok(trail.items.some((e) => e.action === "proposal.revised"), "the revision is audited");
    expectStatus(
      await org.owner.post(`/api/proposals/${r.proposal.id}/revise`, { quantityUpdates: [{ productId: products[0]!.id, quantity: 1 }] }),
      403,
      "someone else revises",
    );
  });

  it("a revision the policy blocks leaves the old proposal usable", async () => {
    const original = await create(1);
    await setLayer(org.approver, "base", { maxOrderValue: 0.01 });
    try {
      const r = ok(
        await org.buyer.post(`/api/proposals/${original.id}/revise`, {
          quantityUpdates: [{ productId: products[0]!.id, quantity: 2 }],
        }),
        201,
        ReviseProposalResponseSchema,
        "revise into BLOCKED",
      );
      assert.equal(r.proposal.status, "BLOCKED");
      assert.equal(r.previousCancelled, false);
      const old = ok(await org.buyer.get(`/api/proposals/${original.id}`), 200, ProposalSchema, "old proposal");
      assert.equal(old.status, "READY", "the old proposal is still usable");
    } finally {
      await setLayer(org.approver, "base", {});
    }
  });
});
