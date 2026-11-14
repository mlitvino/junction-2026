// Scenario 1: sign-up, roles, member management, default-deny and organization isolation.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { HealthResponseSchema } from "@/shared/contracts/health";
import { MeResponseSchema } from "@/shared/contracts/me";
import { MemberSchema, MembersResponseSchema } from "@/shared/contracts/organization";
import { ProposalListSchema } from "@/shared/contracts/purchasing";
import { PublicKeyResponseSchema } from "@/shared/contracts/trust";

import { expectStatus, ok, Session } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { newOrg, RUN, username, type Org } from "./lib/fixtures.ts";

describe("auth and organization", () => {
  let org: Org;
  before(async () => {
    org = await newOrg("auth");
  });
  after(() => cleanup(RUN));

  it("keeps health, the signing key and the docs public; everything else needs a session", async () => {
    const anon = new Session("anonymous");
    ok(await anon.get("/api/health"), 200, HealthResponseSchema, "health");
    ok(await anon.get("/api/trust/public-key"), 200, PublicKeyResponseSchema, "public key");
    expectStatus(await anon.get("/api/openapi.json"), 200, "openapi.json");
    for (const path of ["/api/me", "/api/proposals", "/api/approvals", "/api/products?q=milk", "/api/audit", "/api/orders"])
      expectStatus(await anon.get(path), 401, `anonymous ${path}`);
    expectStatus(await anon.post("/api/proposals", { lines: [{ productId: "469330", quantity: 1 }] }), 401, "anonymous create proposal");
  });

  it("sign-up makes the user buyer and approver of a new organization", async () => {
    const me = ok(await org.owner.get("/api/me"), 200, MeResponseSchema, "owner /api/me");
    assert.deepEqual([...me.user.roles].sort(), ["approver", "buyer"]);
    assert.equal(me.user.username, org.owner.username);
    assert.match(me.user.organization.name, /organization/);
  });

  it("members created by an approver join the same organization with the given roles", async () => {
    const buyerMe = ok(await org.buyer.get("/api/me"), 200, MeResponseSchema, "buyer /api/me");
    const approverMe = ok(await org.approver.get("/api/me"), 200, MeResponseSchema, "approver /api/me");
    assert.deepEqual(buyerMe.user.roles, ["buyer"]);
    assert.deepEqual(approverMe.user.roles, ["approver"]);
    assert.equal(buyerMe.user.organization.id, org.organizationId);
    assert.equal(approverMe.user.organization.id, org.organizationId);

    const list = ok(await org.owner.get("/api/organization/members"), 200, MembersResponseSchema, "list members");
    assert.equal(list.members.length, 3);
  });

  it("enforces roles: buyers don't manage members or approvals, approvers don't buy", async () => {
    expectStatus(await org.buyer.get("/api/organization/members"), 403, "buyer lists members");
    expectStatus(await org.buyer.get("/api/approvals"), 403, "buyer lists approvals");
    expectStatus(await org.buyer.get("/api/audit"), 403, "buyer reads the org audit log");
    expectStatus(
      await org.approver.post("/api/proposals", { lines: [{ productId: "469330", quantity: 1 }] }),
      403,
      "approver creates a proposal",
    );
    expectStatus(await org.approver.post("/api/agent/run", { message: "buy milk" }), 403, "approver runs the agent");
  });

  it("duplicate usernames are refused", async () => {
    expectStatus(
      await org.owner.post("/api/organization/members", { username: org.buyer.username, password: "pw", roles: ["buyer"] }),
      409,
      "create a member with a taken username",
    );
  });

  it("roles can change, but the organization always keeps an approver", async () => {
    // Make the approver-only member a buyer: the owner is then the only approver.
    let m = ok(
      await org.owner.put(`/api/organization/members/${org.approverId}/roles`, { roles: ["buyer"] }),
      200,
      MemberSchema,
      "approver → buyer",
    );
    assert.deepEqual(m.roles, ["buyer"]);
    const me = ok(await org.owner.get("/api/me"), 200, MeResponseSchema, "owner /api/me");
    expectStatus(
      await org.owner.put(`/api/organization/members/${me.user.id}/roles`, { roles: ["buyer"] }),
      409,
      "remove the last approver",
    );
    m = ok(
      await org.owner.put(`/api/organization/members/${org.approverId}/roles`, { roles: ["approver"] }),
      200,
      MemberSchema,
      "back to approver",
    );
    assert.deepEqual(m.roles, ["approver"]);
  });

  it("another organization can't see this one's members, proposals or audit", async () => {
    const stranger = await new Session("stranger").signUp(username("x"));
    const members = ok(await stranger.get("/api/organization/members"), 200, MembersResponseSchema, "stranger members");
    assert.deepEqual(
      members.members.map((m) => m.username),
      [stranger.username],
      "only the stranger's own organization",
    );
    const proposals = ok(await stranger.get("/api/proposals"), 200, ProposalListSchema, "stranger proposals");
    assert.equal(proposals.items.length, 0);
    expectStatus(await stranger.put(`/api/organization/members/${org.buyerId}/roles`, { roles: ["approver"] }), 404, "change a stranger's roles");
  });
});
