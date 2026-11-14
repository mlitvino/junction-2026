// Scenario 2: the organization's preferences — defaults, layers, locks and validation.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { EffectiveResponseSchema, LayersResponseSchema } from "@/shared/contracts/preferences";

import { expectStatus, ok } from "./lib/client.ts";
import { cleanup } from "./lib/db.ts";
import { newOrg, RUN, setLayer, type Org } from "./lib/fixtures.ts";

describe("preferences", () => {
  let org: Org;
  before(async () => {
    org = await newOrg("pref");
  });
  after(() => cleanup(RUN));

  it("starts with the safe defaults: suggest only, no substitutes, no limits", async () => {
    const eff = ok(await org.buyer.get("/api/preferences/effective"), 200, EffectiveResponseSchema, "buyer effective");
    assert.ok(eff.buyer, "a buyer gets the buyer set");
    assert.equal(eff.approver, undefined, "a buyer-only user gets no approver set");
    assert.equal(eff.buyer.values.autonomy, "suggest_only");
    assert.equal(eff.buyer.values.allowSubstitutes, false);
    assert.equal(eff.buyer.values.autoApproveBelow, null);
    assert.equal(eff.buyer.sources.autonomy, "default");

    const both = ok(await org.owner.get("/api/preferences/effective"), 200, EffectiveResponseSchema, "owner effective");
    assert.ok(both.buyer && both.approver, "a user with both roles gets both sets");
  });

  it("only approvers read and edit the layers", async () => {
    expectStatus(await org.buyer.get("/api/preferences/layers"), 403, "buyer reads layers");
    expectStatus(await org.buyer.put("/api/preferences/layers/base", { values: { maxOrderValue: 1 } }), 403, "buyer edits base");
    ok(await org.approver.get("/api/preferences/layers"), 200, LayersResponseSchema, "approver reads layers");
  });

  it("role layers override the base; the effective set says where each value comes from", async () => {
    await setLayer(org.approver, "base", { maxOrderValue: 5000, autoApproveBelow: 1000, excludedAllergens: ["peanuts"] });
    await setLayer(org.approver, "buyer", { autoApproveBelow: 200 });
    const eff = ok(await org.buyer.get("/api/preferences/effective"), 200, EffectiveResponseSchema, "buyer effective");
    assert.equal(eff.buyer!.values.maxOrderValue, 5000);
    assert.equal(eff.buyer!.sources.maxOrderValue, "organization");
    assert.equal(eff.buyer!.values.autoApproveBelow, 200);
    assert.equal(eff.buyer!.sources.autoApproveBelow, "buyer");
    assert.deepEqual(eff.buyer!.values.excludedAllergens, ["peanuts"]);
  });

  it("a locked base setting can't be overridden by a role layer (409)", async () => {
    await setLayer(org.approver, "base", { maxOrderValue: 5000 }, ["maxOrderValue"]);
    expectStatus(
      await org.approver.put("/api/preferences/layers/buyer", { values: { maxOrderValue: 100 } }),
      409,
      "override a locked setting",
    );
    expectStatus(
      await org.approver.put("/api/preferences/layers/buyer", { values: {}, locked: ["autonomy"] }),
      422,
      "locks on a role layer",
    );
    await setLayer(org.approver, "base", { maxOrderValue: 5000 }, []);
  });

  it("refuses invalid combinations (422) and unknown settings (400)", async () => {
    await setLayer(org.approver, "buyer", {});
    expectStatus(
      await org.approver.put("/api/preferences/layers/base", { values: { maxOrderValue: 100, autoApproveBelow: 500 } }),
      422,
      "autoApproveBelow above maxOrderValue",
    );
    expectStatus(
      await org.approver.put("/api/preferences/layers/base", { values: { noSuchSetting: true } }),
      400,
      "unknown setting",
    );
  });
});
