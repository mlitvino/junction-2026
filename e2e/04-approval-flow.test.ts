// Scenario 4 (core): a buyer's proposal goes through approval to an order, and every step can be
// checked afterwards — receipt, hash and signature verification, snapshots and the audit trail.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { after, before, describe, it } from "node:test";

import {
  ApprovalListSchema,
  AuditListSchema,
  OrderReceiptSchema,
  OrderSchema,
  PendingApprovalCountSchema,
  ProposalSchema,
  ProposalVerificationSchema,
  type Proposal,
} from "@/shared/contracts/purchasing";
import { PublicKeyResponseSchema } from "@/shared/contracts/trust";

import { expectError, expectStatus, ok, Session } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { deliveryDate, newOrg, orderableProducts, RUN, type Org, type Pick } from "./lib/fixtures.ts";

describe("proposal → approval → order", () => {
  let org: Org;
  let products: Pick[];
  let proposal: Proposal;
  let orderId: string;
  const date = deliveryDate();
  const idempotencyKey = `${RUN}-order-1`;

  before(async () => {
    org = await newOrg("flow");
    products = await orderableProducts(org.buyer, date);
  });
  after(() => cleanup(RUN));

  it("the buyer creates a proposal: priced, signed, waiting for approval under the default rules", async () => {
    proposal = ok(
      await org.buyer.post("/api/proposals", {
        lines: [
          { productId: products[0]!.id, quantity: 2 },
          { productId: products[1]!.id, quantity: 1 },
        ],
        date,
        note: "e2e approval flow",
      }),
      201,
      ProposalSchema,
      "create proposal",
    );
    assert.equal(proposal.status, "READY");
    assert.equal(proposal.decision.outcome, "REQUIRE_APPROVAL", "default preferences: every order needs approval");
    assert.match(proposal.hash, /^[0-9a-f]{64}$/);
    assert.ok(proposal.signature && proposal.signatureKeyId, "signed");
    assert.ok(proposal.quoteExpiresAt, "prices hold until a deadline");
    assert.equal(proposal.lines.length, 2);
    for (const line of proposal.lines) {
      assert.ok(line.unitPriceExclVat !== null, `${line.productId} priced`);
      assert.ok(line.priceSnapshotId && line.availabilitySnapshotId, `${line.productId} snapshot ids`);
    }
    const expectedTotal = proposal.lines.reduce((s, l) => s + (l.lineTotalExclVat ?? 0), 0);
    assert.ok(Math.abs((proposal.totalExclVat ?? 0) - expectedTotal) < 0.01, "total adds up");
  });

  it("it can't be ordered before approval", async () => {
    expectError(
      await org.buyer.post(`/api/proposals/${proposal.id}/order`, { idempotencyKey }),
      422,
      "APPROVAL_REQUIRED",
      "order before approval",
    );
  });

  it("only the creator sends it; then the approvers' badge counts it", async () => {
    const before = ok(await org.approver.get("/api/approvals/pending-count"), 200, PendingApprovalCountSchema, "count before");
    assert.equal(before.count, 0);
    expectStatus(await org.owner.post(`/api/proposals/${proposal.id}/approval`), 403, "a non-creator sends it");

    proposal = ok(await org.buyer.post(`/api/proposals/${proposal.id}/approval`), 200, ProposalSchema, "send for approval");
    assert.equal(proposal.status, "PENDING_APPROVAL");
    assert.equal(proposal.approval?.status, "PENDING");
    assert.ok(proposal.approval?.expiresAt, "the approval expires with the quote");

    const after = ok(await org.approver.get("/api/approvals/pending-count"), 200, PendingApprovalCountSchema, "count after");
    assert.equal(after.count, 1);
    assert.equal(after.nextExpiresAt, proposal.approval!.expiresAt);

    const list = ok(await org.approver.get("/api/approvals?status=PENDING"), 200, ApprovalListSchema, "pending approvals");
    assert.deepEqual(list.items.map((a) => a.proposalId), [proposal.id]);
  });

  it("the approver must confirm the exact content they reviewed", async () => {
    const approvalId = proposal.approval!.id;
    expectStatus(
      await org.buyer.post(`/api/approvals/${approvalId}/decision`, { decision: "APPROVED", proposalHash: proposal.hash }),
      403,
      "the buyer approves",
    );
    expectError(
      await org.approver.post(`/api/approvals/${approvalId}/decision`, { decision: "APPROVED", proposalHash: "0".repeat(64) }),
      409,
      "HASH_MISMATCH",
      "approve with a different hash",
    );
    proposal = ok(
      await org.approver.post(`/api/approvals/${approvalId}/decision`, { decision: "APPROVED", proposalHash: proposal.hash }),
      200,
      ProposalSchema,
      "approve",
    );
    assert.equal(proposal.status, "APPROVED");
    assert.equal(proposal.approval?.status, "APPROVED");
    expectError(
      await org.approver.post(`/api/approvals/${approvalId}/decision`, { decision: "APPROVED", proposalHash: proposal.hash }),
      409,
      "INVALID_STATE",
      "approve twice",
    );
    const count = ok(await org.approver.get("/api/approvals/pending-count"), 200, PendingApprovalCountSchema, "count");
    assert.equal(count.count, 0);
  });

  it("the buyer orders once; repeating the key replays the same order", async () => {
    const first = ok(await org.buyer.post(`/api/proposals/${proposal.id}/order`, { idempotencyKey }), 201, OrderSchema, "order");
    orderId = first.id;
    assert.equal(first.proposalHash, proposal.hash);
    assert.equal(first.status, "SIMULATED_CONFIRMED");

    const again = ok(await org.buyer.post(`/api/proposals/${proposal.id}/order`, { idempotencyKey }), 200, OrderSchema, "replay");
    assert.equal(again.id, orderId);

    const now = ok(await org.buyer.get(`/api/proposals/${proposal.id}`), 200, ProposalSchema, "proposal after order");
    assert.equal(now.status, "ORDERED");
    assert.equal(now.orderId, orderId);
  });

  it("an idempotency key can't be reused for another proposal", async () => {
    const other = ok(
      await org.buyer.post("/api/proposals", { lines: [{ productId: products[0]!.id, quantity: 1 }], date }),
      201,
      ProposalSchema,
      "second proposal",
    );
    expectError(
      await org.buyer.post(`/api/proposals/${other.id}/order`, { idempotencyKey }),
      409,
      "IDEMPOTENCY_CONFLICT",
      "same key, other proposal",
    );
  });

  it("the receipt names who ordered and who approved, with the signed hash", async () => {
    const receipt = ok(await org.approver.get(`/api/orders/${orderId}/receipt`), 200, OrderReceiptSchema, "receipt");
    assert.equal(receipt.orderedByName, org.buyer.username);
    assert.equal(receipt.approvedByName, org.approver.username);
    assert.equal(receipt.proposalHash, proposal.hash);
    assert.equal(receipt.proposalSignature, proposal.signature);
    assert.equal(receipt.deliveryDate, date);
  });

  it("verify: the hash, the signature and every price snapshot check out", async () => {
    const v = ok(await org.buyer.get(`/api/proposals/${proposal.id}/verify`), 200, ProposalVerificationSchema, "verify");
    assert.equal(v.hashValid, true);
    assert.equal(v.recomputedHash, proposal.hash);
    assert.equal(v.signatureValid, true);
    for (const line of v.lines) {
      assert.equal(line.snapshotFound, true, `${line.productId}: price matches its snapshot`);
      assert.equal(line.priceSnapshotId, proposal.lines.find((l) => l.productId === line.productId)!.priceSnapshotId);
    }
  });

  it("anyone can check the signature offline with the published key", async () => {
    const key = ok(await new Session("anonymous").get("/api/trust/public-key"), 200, PublicKeyResponseSchema, "public key");
    assert.equal(key.keyId, proposal.signatureKeyId);
    const pub = createPublicKey(key.publicKeyPem);
    const message = (hash: string) => Buffer.from(`trusted-trade/proposal/v1\n${proposal.id}\n${hash}`, "utf8");
    const signature = Buffer.from(proposal.signature!, "base64url");
    assert.equal(verify(null, message(proposal.hash), pub, signature), true);
    assert.equal(verify(null, message("f".repeat(64)), pub, signature), false, "a changed hash doesn't verify");
  });

  it("the audit trail tells the story in order", async () => {
    const trail = ok(await org.buyer.get(`/api/proposals/${proposal.id}/audit`), 200, AuditListSchema, "proposal audit");
    const actions = trail.items.map((e) => e.action);
    const expected = ["proposal.created", "approval.requested", "approval.decided", "order.placed"];
    assert.deepEqual(
      actions.filter((a) => expected.includes(a)),
      expected,
      `audit order: ${actions.join(", ")}`,
    );
    const decided = trail.items.find((e) => e.action === "approval.decided")!;
    assert.equal(decided.actorName, org.approver.username);

    const orgLog = ok(await org.approver.get("/api/audit?limit=100"), 200, AuditListSchema, "organization audit");
    assert.ok(orgLog.items.some((e) => e.action === "order.placed" && e.resourceId === proposal.id));
    assert.ok(orgLog.items.some((e) => e.action === "member.created"), "member changes are audited too");
  });
});
