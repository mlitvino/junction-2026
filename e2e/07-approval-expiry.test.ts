// Scenario 7: an approval nobody decides expires with the proposal's quote. The expiry is forced in
// the database (it is 24 h in real time); needs DATABASE_URL, else the scenario is skipped.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { AuditListSchema, PendingApprovalCountSchema, ProposalSchema, type Proposal } from "@/shared/contracts/purchasing";

import { expectError, ok } from "./lib/client.ts";
import { cleanup, forceApprovalExpiry, hasDb } from "./lib/db.ts";
import { deliveryDate, newOrg, orderableProducts, RUN, type Org } from "./lib/fixtures.ts";

describe("approval expiry", { skip: hasDb ? false : "DATABASE_URL is not set" }, () => {
  let org: Org;
  let sent: Proposal;
  const date = deliveryDate();

  before(async () => {
    org = await newOrg("exp");
    const [product] = await orderableProducts(org.buyer, date);
    const created = ok(
      await org.buyer.post("/api/proposals", { lines: [{ productId: product!.id, quantity: 1 }], date }),
      201,
      ProposalSchema,
      "create",
    );
    sent = ok(await org.buyer.post(`/api/proposals/${created.id}/approval`), 200, ProposalSchema, "send");
  });
  after(() => cleanup(RUN));

  it("an overdue approval stops counting, and approval and proposal become EXPIRED", async () => {
    assert.equal(ok(await org.approver.get("/api/approvals/pending-count"), 200, PendingApprovalCountSchema, "count").count, 1);
    await forceApprovalExpiry(sent.id);

    const count = ok(await org.approver.get("/api/approvals/pending-count"), 200, PendingApprovalCountSchema, "count after");
    assert.equal(count.count, 0);
    assert.equal(count.nextExpiresAt, null);

    const p = ok(await org.buyer.get(`/api/proposals/${sent.id}`), 200, ProposalSchema, "proposal");
    assert.equal(p.status, "EXPIRED");
    assert.equal(p.approval?.status, "EXPIRED");
  });

  it("it can't be decided, ordered or cancelled any more", async () => {
    expectError(
      await org.approver.post(`/api/approvals/${sent.approval!.id}/decision`, { decision: "APPROVED", proposalHash: sent.hash }),
      409,
      "APPROVAL_EXPIRED",
      "approve an expired approval",
    );
    expectError(
      await org.buyer.post(`/api/proposals/${sent.id}/order`, { idempotencyKey: `${RUN}-expired` }),
      409,
      "INVALID_STATE",
      "order an expired proposal",
    );
    expectError(await org.buyer.post(`/api/proposals/${sent.id}/cancel`), 409, "INVALID_STATE", "cancel an expired proposal");
  });

  it("the system records the expiry in the audit log", async () => {
    const trail = ok(await org.buyer.get(`/api/proposals/${sent.id}/audit`), 200, AuditListSchema, "audit");
    const expired = trail.items.find((e) => e.action === "approval.expired");
    assert.ok(expired, trail.items.map((e) => e.action).join(", "));
    assert.equal(expired.actorType, "system");
  });
});
