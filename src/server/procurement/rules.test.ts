// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import { canCancel, canDecide, canOrder, canRequestApproval, contentHash, initialStatus } from "./rules.ts";

const code = (r: ReturnType<typeof canOrder>) => (r.ok ? "OK" : r.code);

test("content hash ignores key order and changes with content", () => {
  assert.equal(contentHash({ a: 1, b: [1, { c: 2, d: 3 }] }), contentHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
  assert.equal(contentHash({ a: 1, b: undefined }), contentHash({ a: 1 }));
  assert.match(contentHash([]), /^[0-9a-f]{64}$/);
});

test("initial status follows the policy", () => {
  assert.equal(initialStatus("DENY"), "BLOCKED");
  assert.equal(initialStatus("ALLOW"), "READY");
  assert.equal(initialStatus("REQUIRE_APPROVAL"), "READY");
});

test("approval can be requested only for READY proposals that need it", () => {
  assert.equal(code(canRequestApproval("READY", "REQUIRE_APPROVAL")), "OK");
  assert.equal(code(canRequestApproval("READY", "ALLOW")), "APPROVAL_NOT_NEEDED");
  assert.equal(code(canRequestApproval("BLOCKED", "DENY")), "BLOCKED_BY_POLICY");
  assert.equal(code(canRequestApproval("CANCELLED", "REQUIRE_APPROVAL")), "INVALID_STATE");
});

test("a decision needs a pending approval and the reviewed hash", () => {
  assert.equal(code(canDecide("PENDING", "PENDING_APPROVAL", "h", "h")), "OK");
  assert.equal(code(canDecide("PENDING", "PENDING_APPROVAL", "old", "h")), "HASH_MISMATCH");
  assert.equal(code(canDecide("APPROVED", "APPROVED", "h", "h")), "INVALID_STATE");
  assert.equal(code(canDecide("CANCELLED", "CANCELLED", "h", "h")), "INVALID_STATE");
});

test("ordering: allowed proposals directly, others only after approval of the same content", () => {
  const approved = { status: "APPROVED" as const, proposalHash: "h" };
  assert.equal(code(canOrder("READY", "ALLOW", null, "h")), "OK");
  assert.equal(code(canOrder("APPROVED", "REQUIRE_APPROVAL", approved, "h")), "OK");
  assert.equal(code(canOrder("READY", "REQUIRE_APPROVAL", null, "h")), "APPROVAL_REQUIRED");
  assert.equal(code(canOrder("PENDING_APPROVAL", "REQUIRE_APPROVAL", null, "h")), "APPROVAL_REQUIRED");
  assert.equal(code(canOrder("APPROVED", "REQUIRE_APPROVAL", approved, "other")), "INVALID_STATE");
  assert.equal(code(canOrder("REJECTED", "REQUIRE_APPROVAL", null, "h")), "INVALID_STATE");
  assert.equal(code(canOrder("BLOCKED", "DENY", null, "h")), "BLOCKED_BY_POLICY");
  assert.equal(code(canOrder("ORDERED", "ALLOW", null, "h")), "INVALID_STATE");
  assert.equal(code(canOrder("CANCELLED", "ALLOW", null, "h")), "INVALID_STATE");
});

test("cancelling: only before an order or a final decision", () => {
  for (const s of ["READY", "PENDING_APPROVAL", "APPROVED"] as const) assert.equal(code(canCancel(s)), "OK");
  for (const s of ["ORDERED", "REJECTED", "BLOCKED", "CANCELLED"] as const)
    assert.equal(code(canCancel(s)), "INVALID_STATE");
});
