// Run: pnpm exec node --test src/client/mocks/mock-service.test.mjs
// Uses the existing TypeScript compiler; no additional test dependency or config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(
  clientRoot,
  "../../node_modules/.cache",
  `aimo-procurement-tests-${process.pid}`,
);
for (const file of [
  "provisional/types.ts",
  "provisional/errors.ts",
  "provisional/unavailable-service.ts",
  "mocks/scenarios.ts",
  "mocks/mock-service.ts",
]) {
  const target = join(output, file.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    ts.transpileModule(readFileSync(join(clientRoot, file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
}
const require = createRequire(import.meta.url);
const { createMockProcurementService, DEMO_STORAGE_KEY } = require(
  join(output, "mocks/mock-service.js"),
);
const { createUnavailableProcurementService } = require(
  join(output, "provisional/unavailable-service.js"),
);
const { demoScenarios } = require(join(output, "mocks/scenarios.js"));
const { AgentEventSchema, DemoStateSchema } = require(join(output, "provisional/types.js"));
const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};
const service = (storage = memory(), overrides = {}) =>
  createMockProcurementService({
    storage: () => storage,
    wait: async () => {},
    now: () => "2026-11-14T10:00:00.000Z",
    ...overrides,
  });
const request = (scenarioId, clientRequestId = "test-request") => ({
  scenarioId,
  clientRequestId,
  message: demoScenarios.find((s) => s.id === scenarioId).prompt,
});
const state = (service) => service.getSnapshot().state;
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
async function pending(service) {
  await service.startConversation(request("human-approval-budget"));
  const proposal = state(service).proposals[0];
  return service.requestApproval(proposal.id, proposal.version);
}

test("autonomous scenario emits valid ordered events and exactly one linked local order", async () => {
  const s = service();
  const events = [];
  for await (const event of s.streamAgentChat(request("happy-path-auto"))) {
    AgentEventSchema.parse(event);
    events.push(event);
  }
  assert.deepEqual(
    events.map((e) => e.sequence),
    events.map((_, i) => i + 1),
  );
  assert.equal(events.at(-1).event, "done");
  assert(events.some((e) => e.event === "intent.ready"));
  assert(events.some((e) => e.event === "order.committed"));
  const data = DemoStateSchema.parse(state(s));
  assert.equal(data.orders.length, 1);
  assert.equal(data.orders[0].source, "LOCAL_SIMULATOR");
  assert.equal(data.orders[0].upstreamOrderId, null);
  assert.equal(data.orders[0].totalGross.amountMinor, "15500");
  assert.equal(data.conversations[0].orderId, data.orders[0].id);
  assert.equal(data.proposals[0].orderId, data.orders[0].id);
});

test("approval is requested once, bound to the exact snapshot, and double approval commits once", async () => {
  const s = service();
  const approvalId = await pending(s);
  const p = state(s).proposals[0];
  assert.equal(state(s).orders.length, 0);
  assert.equal(await s.requestApproval(p.id, p.version), approvalId);
  assert.equal(state(s).approvals.length, 1);
  const hash = state(s).approvals[0].proposalHash;
  await rejectsCode(s.decideApproval(approvalId, hash, "APPROVED", ""), "DEMO_ROLE_REQUIRED");
  await s.setDemoRole("APPROVER");
  await rejectsCode(s.decideApproval(approvalId, "stale-token", "APPROVED", ""), "STALE_APPROVAL");
  assert.equal(state(s).approvals[0].status, "PENDING");
  await Promise.all([
    s.decideApproval(approvalId, hash, "APPROVED", ""),
    s.decideApproval(approvalId, hash, "APPROVED", ""),
  ]);
  assert.equal(state(s).orders.length, 1);
  assert.equal(state(s).approvals[0].status, "APPROVED");
  assert.equal(state(s).orders[0].proposalSnapshot.approvalId, approvalId);
  await rejectsCode(
    s.decideApproval(approvalId, hash, "REJECTED", "Changed my mind"),
    "ALREADY_DECIDED",
  );
});

test("rejection requires a reason, remains rejected on replay, and never creates an order", async () => {
  const s = service();
  const approvalId = await pending(s);
  await s.setDemoRole("APPROVER");
  const hash = state(s).approvals[0].proposalHash;
  await rejectsCode(s.decideApproval(approvalId, hash, "REJECTED", " "), "REASON_REQUIRED");
  await s.decideApproval(approvalId, hash, "REJECTED", "Budget needs review");
  await s.decideApproval(approvalId, hash, "REJECTED", "Budget needs review");
  assert.equal(state(s).approvals[0].note, "Budget needs review");
  assert.equal(state(s).proposals[0].status, "REJECTED");
  assert.equal(state(s).orders.length, 0);
  await rejectsCode(s.decideApproval(approvalId, hash, "APPROVED", ""), "ALREADY_DECIDED");
});

test("unknown mandatory evidence blocks purchase and approval", async () => {
  const s = service();
  await s.startConversation(request("allergen-blocked"));
  const p = state(s).proposals[0];
  assert.equal(p.policyDecision.outcome, "DENY");
  assert.equal(p.lines[0].evidence.match, "UNKNOWN");
  await rejectsCode(s.commitOrder(p.id, 1, "blocked"), "INVALID_STATE");
  await rejectsCode(s.requestApproval(p.id, 1), "INVALID_STATE");
  assert.equal(state(s).orders.length, 0);
});

test("duplicate submissions and commit keys are idempotent; conflicting payloads are rejected", async () => {
  const s = service();
  const req = request("happy-path-auto");
  const ids = await Promise.all([s.startConversation(req), s.startConversation(req)]);
  assert.equal(ids[0], ids[1]);
  assert.equal(state(s).conversations.length, 1);
  assert.equal(state(s).orders.length, 1);
  const p = state(s).proposals[0];
  assert.equal(await s.commitOrder(p.id, 1, "same-key"), state(s).orders[0].id);
  assert.equal(await s.commitOrder(p.id, 1, "same-key"), state(s).orders[0].id);
  await rejectsCode(s.commitOrder(p.id, 2, "same-key"), "IDEMPOTENCY_CONFLICT");
  await rejectsCode(s.commitOrder(p.id, 2, "new-key"), "STALE_PROPOSAL");
  await rejectsCode(s.startConversation(request("human-approval-budget")), "IDEMPOTENCY_CONFLICT");
  assert.equal(state(s).orders.length, 1);
});

test("refresh between proposal and commit stops the run and cannot replay a purchase", async () => {
  const storage = memory();
  const original = service(storage);
  const req = request("happy-path-auto");
  const iterator = original.streamAgentChat(req);
  while ((await iterator.next()).value.event !== "proposal.ready") {
    /* pause before commit */
  }
  const restored = service(storage);
  restored.initialize();
  assert.equal(state(restored).conversations[0].status, "INTERRUPTED");
  assert.equal(state(restored).proposals[0].status, "FAILED");
  assert.equal(state(restored).orders.length, 0);
  await restored.startConversation(req);
  await rejectsCode(
    restored.commitOrder(state(restored).proposals[0].id, 1, "try-again"),
    "INVALID_STATE",
  );
  assert.equal(state(restored).orders.length, 0);
});

test("an order already persisted before refresh is retained and not repeated", async () => {
  const storage = memory();
  const original = service(storage);
  const req = request("happy-path-auto");
  const iterator = original.streamAgentChat(req);
  while ((await iterator.next()).value.event !== "order.committed") {
    /* pause after durable local record */
  }
  const restored = service(storage);
  restored.initialize();
  assert.equal(state(restored).orders.length, 1);
  assert.equal(state(restored).conversations[0].status, "INTERRUPTED");
  await restored.startConversation(req);
  assert.equal(state(restored).orders.length, 1);
});

test("reset stops an in-flight run without restoring old data", async () => {
  let resume;
  const barrier = new Promise((resolve) => {
    resume = resolve;
  });
  const s = service(memory(), { wait: () => barrier });
  const pendingRun = s.startConversation(request("happy-path-auto"));
  await s.resetDemo();
  resume();
  await pendingRun;
  assert.equal(state(s).conversations.length, 0);
  assert.equal(state(s).orders.length, 0);
});

test("unsupported text does not persist arbitrary drafts or create business entities", async () => {
  const storage = memory();
  const s = service(storage);
  await rejectsCode(
    s.startConversation({
      ...request("happy-path-auto"),
      message: "Order something entirely different",
    }),
    "UNSUPPORTED_DEMO_REQUEST",
  );
  assert.equal(state(s).conversations.length, 0);
  assert(!storage.getItem(DEMO_STORAGE_KEY).includes("entirely different"));
});

test("corrupt or unavailable demo storage is recoverable and reports a notice", async () => {
  const storage = memory();
  storage.setItem(DEMO_STORAGE_KEY, "not-json");
  const s = service(storage);
  s.initialize();
  assert(s.getSnapshot().storageNotice);
  const blocked = service({
    getItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Blocked");
    },
  });
  await blocked.startConversation(request("happy-path-auto"));
  assert.equal(state(blocked).orders.length, 1);
  assert(blocked.getSnapshot().storageNotice.includes("reset on refresh"));
});

test("completed entities and demo role survive same-tab refresh; snapshots are immutable", async () => {
  const storage = memory();
  const s = service(storage);
  await s.startConversation(request("happy-path-auto"));
  await s.setDemoRole("APPROVER");
  const restored = service(storage);
  restored.initialize();
  assert.equal(state(restored).role, "APPROVER");
  assert.equal(state(restored).orders.length, 1);
  assert.throws(() => {
    state(restored).orders[0].totalGross.amountMinor = "0";
  }, TypeError);
});

test("real mode explicitly rejects operations and exposes no fixtures", async () => {
  const s = createUnavailableProcurementService();
  assert.equal(s.getSnapshot().mode, "unavailable");
  assert.equal(s.getSnapshot().products.length, 0);
  await rejectsCode(s.startConversation(request("happy-path-auto")), "INTEGRATION_UNAVAILABLE");
  await rejectsCode(s.decideApproval("any", "any", "APPROVED", ""), "INTEGRATION_UNAVAILABLE");
});

test("an execution failure emits an error and never records a purchase", async () => {
  const s = service(memory(), {
    wait: async () => {
      throw new Error("Injected demo transport failure");
    },
  });
  const events = [];
  for await (const event of s.streamAgentChat(request("happy-path-auto"))) events.push(event);
  assert.equal(events.at(-1).event, "error");
  assert.equal(state(s).conversations[0].status, "FAILED");
  assert.equal(state(s).orders.length, 0);
});

test("a second different request cannot run concurrently with the first", async () => {
  let resume;
  const barrier = new Promise((resolve) => {
    resume = resolve;
  });
  const s = service(memory(), { wait: () => barrier });
  const first = s.startConversation(request("happy-path-auto", "first"));
  await rejectsCode(s.startConversation(request("happy-path-auto", "second")), "RUN_IN_PROGRESS");
  resume();
  await first;
  assert.equal(state(s).conversations.length, 1);
  assert.equal(state(s).orders.length, 1);
});

// ----- Connected mode ("simulated"): the signed-in user's real roles decide, data per user.
const actor = (id, roles) => ({ id, displayName: id, roles });
const simulated = (storage = memory()) => service(storage, { mode: "simulated" });

test("simulated mode waits for the signed-in user before loading", async () => {
  const s = simulated();
  s.initialize();
  assert.equal(s.getSnapshot().ready, false);
  assert.equal(s.getSnapshot().mode, "simulated");
  await rejectsCode(s.startConversation(request("happy-path-auto")), "NOT_SIGNED_IN");
  s.setActor(actor("alice", ["BUYER", "APPROVER"]));
  assert.equal(s.getSnapshot().ready, true);
});

test("a user with both roles can request and approve; activity names the user", async () => {
  const s = simulated();
  s.setActor(actor("alice", ["BUYER", "APPROVER"]));
  const approvalId = await pending(s);
  const hash = state(s).approvals[0].proposalHash;
  await s.decideApproval(approvalId, hash, "APPROVED", "");
  assert.equal(state(s).orders.length, 1);
  assert.equal(state(s).approvals[0].decidedByUserId, "alice");
  assert(state(s).activities.some((a) => a.actorType === "USER" && a.actorId === "alice"));
  assert(
    !state(s).activities.some(
      (a) => a.actorId.startsWith("demo-b") || a.actorId === "demo-approver",
    ),
  );
});

test("buyer-only can't approve and approver-only can't request", async () => {
  const storage = memory();
  const buyer = simulated(storage);
  buyer.setActor(actor("bob", ["BUYER"]));
  const approvalId = await pending(buyer);
  const hash = state(buyer).approvals[0].proposalHash;
  await rejectsCode(buyer.decideApproval(approvalId, hash, "APPROVED", ""), "ROLE_REQUIRED");

  const approver = simulated(memory());
  approver.setActor(actor("carol", ["APPROVER"]));
  await rejectsCode(approver.startConversation(request("happy-path-auto")), "ROLE_REQUIRED");
});

test("roles come from the account: the demo role switch is refused", async () => {
  const s = simulated();
  s.setActor(actor("bob", ["BUYER"]));
  await rejectsCode(s.setDemoRole("APPROVER"), "ROLE_FROM_ACCOUNT");
});

test("each user gets their own simulation; switching users doesn't leak data", async () => {
  const storage = memory();
  const s = simulated(storage);
  s.setActor(actor("alice", ["BUYER", "APPROVER"]));
  await s.startConversation(request("happy-path-auto"));
  assert.equal(state(s).orders.length, 1);

  s.setActor(actor("bob", ["BUYER"]));
  assert.equal(state(s).conversations.length, 0);
  assert.equal(state(s).orders.length, 0);
  assert.notEqual(storage.getItem(`${DEMO_STORAGE_KEY}:alice`), null);
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), null);

  s.setActor(actor("alice", ["BUYER", "APPROVER"]));
  assert.equal(state(s).orders.length, 1);
});
