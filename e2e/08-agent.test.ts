// Scenario 8: the agent turns words into a normal proposal (units converted, ranked, same rules).
// Runs with TEST_MODE=TRUE (deterministic) or a Gemini key; skipped when the server answers
// 503 AGENT_NOT_CONFIGURED.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { AgentRunResponseSchema } from "@/shared/contracts/agent";
import { ProductDetailSchema } from "@/shared/contracts/products";
import { ProposalFromPromptResponseSchema } from "@/shared/contracts/purchasing";

import { expectStatus, ok } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { deliveryDate, newOrg, RUN, type Org } from "./lib/fixtures.ts";

describe("agent", () => {
  let org: Org;
  const date = deliveryDate();
  before(async () => {
    org = await newOrg("agt");
  });
  after(() => cleanup(RUN));

  const notConfigured = (r: { status: number; body: unknown }) =>
    r.status === 503 && (r.body as { code?: string } | null)?.code === "AGENT_NOT_CONFIGURED";

  it("from-prompt: 1000 litres of lactose-free milk become whole sales units of a real milk", async (t) => {
    const r = await org.buyer.post("/api/proposals/from-prompt", { prompt: "1000 litres of lactose-free milk", date });
    if (notConfigured(r)) return t.skip("agent not configured on the server (set TEST_MODE=TRUE or a Gemini key)");
    const res = ok(r, 201, ProposalFromPromptResponseSchema, "from-prompt");
    assert.ok(res.proposal, `a proposal: ${res.message}`);
    assert.equal(res.proposal.source, "agent");
    const line = res.proposal.lines[0]!;
    assert.match(line.name, /milk|maito/i);
    assert.doesNotMatch(line.name, /choco|cheese|juusto/i, "a relevant product, not a milk-flavoured one");

    const trace = res.selection.pipeline[0]!;
    assert.ok(trace.conversionNote, "the conversion is explained");
    const product = ok(await org.buyer.get(`/api/products/${line.productId}`), 200, ProductDetailSchema, "chosen product");
    if (product.contentPerSalesUnit?.unit === "L") {
      const litres = line.quantity * product.contentPerSalesUnit.value;
      assert.ok(
        litres >= 1000 && litres < 1000 + product.contentPerSalesUnit.value,
        `${line.quantity} × ${product.contentPerSalesUnit.value} L covers 1000 L (${trace.conversionNote})`,
      );
      assert.equal(line.substituteFor, null, "converted, so not a substitute");
    }
    // Default rules: everything needs approval. A DENY here means the agent picked something the
    // policy can't accept (e.g. not deliverable), i.e. selection and policy disagree.
    assert.equal(
      res.proposal.decision.outcome,
      "REQUIRE_APPROVAL",
      `the agent's pick passes the same rules; reasons: ${res.proposal.decision.reasons.map((r) => `${r.code} (${r.message})`).join("; ")}`,
    );
  });

  it("agent/run acts for the signed-in buyer and returns the proposal it worked on", async (t) => {
    const r = await org.buyer.post("/api/agent/run", { message: "I need 20 litres of lactose-free milk", deliveryDate: date });
    if (notConfigured(r)) return t.skip("agent not configured on the server");
    const res = ok(r, 200, AgentRunResponseSchema, "agent run");
    assert.ok(res.reply.length > 0);
    if (res.activeProposal) {
      assert.equal(res.activeProposal.createdByName, org.buyer.username, "created as the buyer, not anonymously");
      assert.notEqual(res.activeProposal.status, "ORDERED", "default rules: the agent can't order without approval");
    }
  });

  it("only buyers run the agent", async () => {
    expectStatus(await org.approver.post("/api/agent/run", { message: "buy milk" }), 403, "approver runs the agent");
  });
});
