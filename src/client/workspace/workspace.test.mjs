import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = join(root, "node_modules/.cache", `v32-tests-${process.pid}`);
for (const file of [
  ...readdirSync(join(root, "src/shared/contracts"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/shared/contracts/${f}`),
  ...["http", "model", "mock-api", "service"].map((f) => `src/client/workspace/${f}.ts`),
]) {
  const destination = join(output, file.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(destination), { recursive: true });
  const text = readFileSync(join(root, file), "utf8").replace(/from "@\/([^"]+)"/g, (_, path) => {
    let local = relative(dirname(destination), join(output, "src", path)).replaceAll("\\", "/");
    if (!local.startsWith(".")) local = "./" + local;
    return `from "${local}"`;
  });
  writeFileSync(
    destination,
    ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
}
const require = createRequire(import.meta.url);
const { createMockApi } = require(join(output, "src/client/workspace/mock-api.js"));
const { createHttpApi, ApiError } = require(join(output, "src/client/workspace/http.js"));
const { createWorkspaceService, compatibleQuantity, recipeNeeds } = require(
  join(output, "src/client/workspace/service.js"),
);
const { ProposalSchema, OrderSchema } = require(join(output, "src/shared/contracts/purchasing.js"));
const { EffectiveResponseSchema } = require(join(output, "src/shared/contracts/preferences.js"));
const { getConversationStatus, getConversationTimeline, ThreadSchema } = require(
  join(output, "src/client/workspace/model.js"),
);
const memory = () => {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), values };
};
async function setup() {
  const storage = memory(),
    mock = createMockApi(() => storage),
    service = createWorkspaceService(mock.api, {
      mock: true,
      capabilities: mock,
      storage: () => storage,
    });
  await service.initialize();
  return { service, mock, storage };
}
const state = (service) => service.getSnapshot();

test("conversation timeline preserves selections, proposals and later messages across refresh", async () => {
  const { service, mock, storage } = await setup();
  const id = service.newThread("Product selection");
  await service.sendMessage(id, "Find milk");
  const thread = () => state(service).local.threads.find((t) => t.id === id);
  const picker = thread().timeline.find((entry) => entry.kind === "products");
  assert(picker);
  const originalCreate = mock.api.createProposal;
  mock.api.createProposal = async () => {
    throw new Error("Creation failed");
  };
  await assert.rejects(
    service.createPurchase(
      { lines: [{ productId: "milk", quantity: 2 }] },
      id,
      "Manual",
      undefined,
      picker.id,
    ),
    /Creation failed/,
  );
  assert.equal(thread().timeline.find((entry) => entry.kind === "products").closed, undefined);
  mock.api.createProposal = originalCreate;
  const result = await service.createPurchase(
    { lines: [{ productId: "milk", quantity: 2 }] },
    id,
    "Manual",
    undefined,
    picker.id,
  );
  assert.deepEqual(
    thread().timeline.map((entry) => entry.kind),
    ["message", "message", "products", "message", "proposal"],
  );
  assert.equal(thread().timeline[2].proposalId, result.proposal.id);
  assert.equal(thread().timeline[2].closed, true);
  await assert.rejects(
    service.createPurchase(
      { lines: [{ productId: "milk", quantity: 3 }] },
      id,
      "Manual",
      undefined,
      picker.id,
    ),
    /selection is closed/,
  );
  assert.equal(state(service).proposals.length, 1);
  await service.sendMessage(id, "Why this product?");
  assert.deepEqual(
    thread()
      .timeline.slice(-2)
      .map((entry) => entry.kind),
    ["message", "message"],
  );
  await service.sendMessage(id, "Show another alternative");
  assert.equal(thread().timeline.at(-1).kind, "products");
  assert.notEqual(thread().timeline.at(-1).id, picker.id);
  assert.equal(thread().timeline.at(-1).replacementId, result.proposal.id);
  const saved = JSON.parse(JSON.stringify(thread().timeline));
  const resumed = createWorkspaceService(mock.api, {
    mock: true,
    capabilities: mock,
    storage: () => storage,
  });
  await resumed.initialize();
  assert.deepEqual(state(resumed).local.threads.find((t) => t.id === id).timeline, saved);
  const legacy = { ...thread(), timeline: undefined };
  assert(ThreadSchema.safeParse(legacy).success);
  const recovered = getConversationTimeline(legacy, state(service).proposals);
  assert(
    recovered.findIndex((entry) => entry.kind === "products") <
      recovered.findIndex((entry) => entry.kind === "proposal"),
  );
  assert.equal(recovered.find((entry) => entry.kind === "products").proposalId, result.proposal.id);
});

test("recent conversation status follows its latest purchase and never invents a recorded order", async () => {
  const { service } = await setup();
  const id = service.newThread("Status test");
  const thread = () => state(service).local.threads.find((t) => t.id === id);
  assert.deepEqual(getConversationStatus(thread(), state(service)), {
    status: "DRAFT",
    label: "No purchase yet",
  });
  const { proposal } = await service.createPurchase(
    { lines: [{ productId: "milk", quantity: 2 }] },
    id,
  );
  assert.equal(getConversationStatus(thread(), state(service)).status, "PENDING_APPROVAL");
  for (const status of [
    "READY",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "BLOCKED",
    "CANCELLED",
  ]) {
    assert.equal(
      getConversationStatus(thread(), { ...state(service), proposals: [{ ...proposal, status }] })
        .status,
      status,
    );
  }
  assert.deepEqual(getConversationStatus({ ...thread(), working: true }, state(service)), {
    status: "PENDING",
    label: "Preparing",
  });
  assert.deepEqual(getConversationStatus({ ...thread(), safetyBlocked: true }, state(service)), {
    status: "BLOCKED",
    label: "Needs attention",
  });
  const expired = { ...proposal, quoteExpiresAt: "2020-01-01T00:00:00.000Z" };
  assert.equal(
    getConversationStatus(thread(), { ...state(service), proposals: [expired] }).label,
    "Refresh prices",
  );
  assert.equal(
    getConversationStatus(thread(), {
      ...state(service),
      local: { ...state(service).local, stale: [proposal.id] },
    }).label,
    "Refresh prices",
  );
  await service.approve(proposal.id, "APPROVED");
  assert.equal(getConversationStatus(thread(), state(service)).status, "APPROVED");
  await service.placeOrder(proposal.id);
  assert.equal(getConversationStatus(thread(), state(service)).status, "ORDERED");
  assert.equal(
    getConversationStatus({ ...thread(), error: "A later question failed" }, state(service)).status,
    "ORDERED",
  );
  assert.deepEqual(
    getConversationStatus(
      { ...thread(), proposals: [...thread().proposals, "not-loaded"] },
      state(service),
    ),
    { status: "UNKNOWN", label: "Status unavailable" },
  );
  assert.equal(
    getConversationStatus({ ...thread(), safetyBlocked: true }, state(service)).label,
    "New request blocked",
  );
});

test("approval-first, same review object and idempotent canonical order", async () => {
  const { service } = await setup();
  const id = service.newThread("Milk");
  await service.sendMessage(id, "Order 100 litres of lactose-free milk");
  const proposal = ProposalSchema.parse(state(service).proposals[0]);
  assert.equal(proposal.status, "PENDING_APPROVAL");
  assert.equal(proposal.totalExclVat, 155);
  assert.equal(proposal.createdByName, "anna.lindholm");
  assert.equal(proposal.source, "buyer");
  assert.equal(proposal.selection, null);
  assert.equal(proposal.approval.requestedByName, "anna.lindholm");
  assert.equal(proposal.approval.decidedByName, null);
  assert.equal(state(service).orders.length, 0);
  assert.equal(state(service).approvals[0].id, proposal.approval.id);
  await service.approve(proposal.id, "APPROVED");
  assert.equal(state(service).proposals[0].approval.decidedByName, "anna.lindholm");
  const [a, b] = await Promise.all([
    service.placeOrder(proposal.id),
    service.placeOrder(proposal.id),
  ]);
  assert.equal(a.id, b.id);
  OrderSchema.parse(a);
  assert.equal(a.createdByName, "anna.lindholm");
  assert.equal(state(service).orders.length, 1);
  assert.equal(state(service).proposals[0].status, "ORDERED");
});
test("quantity revision cancels the former approval; information never changes a version", async () => {
  const { service } = await setup();
  const id = service.newThread("Milk");
  await service.sendMessage(id, "Order 100 litres of milk");
  const first = state(service).proposals[0];
  await service.sendMessage(id, "Why this product?");
  assert.equal(state(service).local.threads[0].proposals.length, 1);
  await service.sendMessage(id, "Make it 150 litres");
  const revised = state(service).proposals[0];
  assert.notEqual(revised.id, first.id);
  assert.notEqual(revised.hash, first.hash);
  assert.equal(state(service).proposals.find((p) => p.id === first.id).status, "CANCELLED");
  assert.equal(
    state(service).approvals.find((a) => a.id === first.approval.id).status,
    "CANCELLED",
  );
  await assert.rejects(service.approve(first.id, "APPROVED"));
  assert.equal(state(service).orders.length, 0);
});
test("rejection stays final and a revision creates a fresh request", async () => {
  const { service } = await setup();
  const id = service.newThread("Milk");
  await service.sendMessage(id, "Order 100 litres of milk");
  const first = state(service).proposals[0];
  await assert.rejects(service.approve(first.id, "REJECTED", ""));
  await service.approve(first.id, "REJECTED", "Quantity too high");
  await service.sendMessage(id, "Make it 50 litres");
  assert.equal(state(service).proposals.find((p) => p.id === first.id).status, "REJECTED");
  assert.equal(state(service).proposals[0].lines[0].quantity, 50);
  assert.equal(state(service).orders.length, 0);
});
test("buyer-only cannot approve; both capabilities can self-approve", async () => {
  const { service } = await setup();
  await service.setRoles(["buyer"]);
  const id = service.newThread("Milk");
  await service.sendMessage(id, "Order 100 litres of milk");
  const p = state(service).proposals[0];
  await assert.rejects(service.approve(p.id, "APPROVED"));
  await service.setRoles(["buyer", "approver"]);
  await service.approve(p.id, "APPROVED");
  assert.equal(state(service).proposals[0].status, "APPROVED");
});
test("mandatory safety changes cancel a pending purchase and never create a bypass order", async () => {
  const { service } = await setup();
  const id = service.newThread("Milk");
  await service.sendMessage(id, "Order 100 litres of milk");
  const p = state(service).proposals[0];
  await service.sendMessage(id, "Order milk-protein-free oat drink");
  assert(state(service).local.threads[0].safetyBlocked);
  assert.equal(state(service).proposals.find((x) => x.id === p.id).status, "CANCELLED");
  await assert.rejects(service.placeOrder(p.id));
  assert.equal(state(service).orders.length, 0);
});
test("quote conflicts preserve the approved server record and do not fall back", async () => {
  const { service, mock } = await setup();
  const result = await service.createPurchase({
    lines: [{ productId: "milk", quantity: 100 }],
    date: "2026-11-20",
  });
  await service.approve(result.proposal.id, "APPROVED");
  mock.setFault("price");
  await assert.rejects(service.placeOrder(result.proposal.id), (e) => e.code === "PRICE_CHANGED");
  assert.equal(state(service).orders.length, 0);
  assert(state(service).local.stale.includes(result.proposal.id));
  mock.setFault("none");
  const order = await service.placeOrder(result.proposal.id);
  assert(order.id);
  assert.equal(state(service).orders.length, 1);
});
test("restock 8kg → 40kg uses verified 4kg cases; existing pending coverage is excluded", async () => {
  const { service } = await setup();
  const run = await service.checkPlan("pizza-cheese");
  assert.equal(run.lines[0].quantity, 8);
  assert.equal(run.lines[0].unit, "KI");
  assert.equal(run.lines[0].state, "ready");
  const prepared = await service.prepareRun(run.id);
  assert.equal(state(service).proposals[0].status, "PENDING_APPROVAL");
  assert.equal((await service.prepareRun(run.id)).threadId, prepared.threadId);
  const next = await service.checkPlan("pizza-cheese");
  assert.equal(next.lines[0].state, "partial");
  assert.match(next.lines[0].reason, /open purchase/);
});
test("recipe math aggregates compatible units and subtracts on-hand stock once", () => {
  const recipe = {
    baseServings: 100,
    ingredients: [
      { productName: "Onion", productType: "Onion", quantity: 1, unit: "KG" },
      { productName: "Onion", productType: "Onion", quantity: 500, unit: "G" },
    ],
  };
  const rows = recipeNeeds(recipe, 1000, [
    { ingredientName: "Onion", quantityInStock: 2, unit: "KG" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].needed, 15);
  assert.equal(rows[0].shortage, 13);
  assert.equal(compatibleQuantity(1000, "G", "KG"), 1);
  assert.equal(compatibleQuantity(1, "L", "KG"), null);
});
test("refresh never resumes a local interrupted operation; connected persistence holds only UI references", async () => {
  const { service, mock, storage } = await setup();
  const id = service.newThread("Interrupted");
  service.draft(id, "Keep this draft");
  const raw = storage.getItem("aimo:v32:development:presentation");
  const local = JSON.parse(raw);
  local.threads[0].working = true;
  storage.setItem("aimo:v32:development:presentation", JSON.stringify(local));
  const restored = createWorkspaceService(mock.api, { mock: true, storage: () => storage });
  await restored.initialize();
  assert.equal(state(restored).local.threads[0].working, false);
  assert.match(state(restored).local.threads[0].error, /interrupted/);
  assert.equal(state(restored).orders.length, 0);
  assert(!Object.hasOwn(JSON.parse(raw), "orders"));
  assert(!Object.hasOwn(JSON.parse(raw), "proposals"));
});
test("layer inheritance, base locks, and invalid limit combinations remain distinct", async () => {
  const { service } = await setup();
  await service.saveLayer("base", {
    values: { maxOrderValue: 500, language: "fi" },
    locked: ["language"],
  });
  await assert.rejects(service.saveLayer("buyer", { values: { language: "sv" } }));
  await assert.rejects(service.saveLayer("buyer", { values: { autoApproveBelow: 600 } }));
  await service.loadSettings();
  assert.equal(state(service).effective.buyer.values.language, "fi");
  assert.equal(state(service).effective.buyer.sources.language, "organization");
});

test("expanded preference lists and nullable limits round-trip through effective settings", async () => {
  const { service, mock } = await setup();
  const initial = EffectiveResponseSchema.parse(await mock.api.getEffective());
  for (const role of ["buyer", "approver"]) {
    for (const key of [
      "dietaryRestrictions",
      "allowedCategories",
      "blockedCategories",
      "allowedProductIds",
      "blockedProductIds",
    ])
      assert.deepEqual(initial[role].values[key], []);
    assert.equal(initial[role].values.maxUnitPrice, null);
    assert.equal(initial[role].values.maxLineQuantity, null);
  }
  const values = {
    dietaryRestrictions: ["vegetarian"],
    allowedCategories: ["FOOD"],
    blockedCategories: ["REVIEW"],
    allowedProductIds: ["milk"],
    blockedProductIds: ["oat"],
    maxUnitPrice: 20,
    maxLineQuantity: 100,
  };
  await service.saveLayer("base", { values, locked: ["dietaryRestrictions"] });
  const effective = EffectiveResponseSchema.parse(await mock.api.getEffective());
  for (const [key, value] of Object.entries(values)) {
    assert.deepEqual(effective.buyer.values[key], value);
    assert.equal(effective.buyer.sources[key], "organization");
  }
  await assert.rejects(service.saveLayer("buyer", { values: { dietaryRestrictions: [] } }));
  await service.saveLayer("buyer", { values: { maxUnitPrice: null, maxLineQuantity: null } });
  const buyer = EffectiveResponseSchema.parse(await mock.api.getEffective()).buyer;
  assert.equal(buyer.values.maxUnitPrice, null);
  assert.equal(buyer.values.maxLineQuantity, null);
  assert.equal(buyer.sources.maxUnitPrice, "buyer");
});
test("HTTP adapter uses canonical paths/hash/net amounts and preserves explicit error codes", async () => {
  const { mock } = await setup();
  const p = await mock.api.createProposal({
    lines: [{ productId: "milk", quantity: 2 }],
    date: "2026-11-20",
  });
  const calls = [];
  const http = createHttpApi(async (url, init) => {
    calls.push({ url, init });
    return Response.json(p);
  });
  const returned = await http.createProposal({
    lines: [{ productId: "milk", quantity: 2 }],
    date: "2026-11-20",
  });
  assert.equal(returned.totalExclVat, 3.1);
  assert.equal(calls[0].url, "/api/proposals");
  assert.equal(calls[0].init.credentials, "same-origin");
  await http.decideApproval("A-1", { decision: "APPROVED", proposalHash: p.hash });
  assert.equal(JSON.parse(calls[1].init.body).proposalHash, p.hash);
  assert.equal(calls[1].url, "/api/approvals/A-1/decision");
  const failing = createHttpApi(async () =>
    Response.json({ error: "Prices changed", code: "PRICE_CHANGED" }, { status: 409 }),
  );
  await assert.rejects(
    failing.placeOrder(p.id, "stable-key"),
    (e) => e instanceof ApiError && e.code === "PRICE_CHANGED" && e.status === 409,
  );
  const mismatch = createHttpApi(async () => Response.json({ orderId: "legacy-order" }));
  await assert.rejects(mismatch.getOrder("anything"), (e) => e.code === "CONTRACT_MISMATCH");
});
test("missing physical volume conversion never uses a hard-coded product map", async () => {
  const { service } = await setup();
  assert.equal(await service.toSales("pasta", 100, "L"), null);
  assert.equal(await service.toSales("cheese", 32, "KG"), 8);
});

test("failed review submission retains the canonical proposal for an explicit retry", async () => {
  const { mock, storage } = await setup();
  let attempts = 0;
  const service = createWorkspaceService(
    {
      ...mock.api,
      requestApproval: async () => {
        attempts++;
        throw new ApiError("Temporarily unavailable", 503);
      },
    },
    { mock: true, storage: () => storage },
  );
  await service.initialize();
  const result = await service.createPurchase({ lines: [{ productId: "milk", quantity: 2 }] });
  assert.equal(result.proposal.status, "READY");
  assert.equal(attempts, 1);
  assert.equal(state(service).proposals.length, 1);
  assert.match(state(service).local.threads[0].error, /without creating another/);
  assert.equal(state(service).orders.length, 0);
});

test("connected 401 and contract failures cannot silently activate fixture identity", async () => {
  const http = createHttpApi(async () =>
    Response.json({ error: "Not signed in" }, { status: 401 }),
  );
  const service = createWorkspaceService(http, { mock: false, storage: memory });
  await service.initialize();
  assert.equal(state(service).user, null);
  assert.match(state(service).error, /Not signed in/);
  assert.equal(state(service).proposals.length, 0);
});

test("dietary changes cannot be bypassed through restock or manual selection in the same thread", async () => {
  const { service } = await setup();
  const id = service.newThread("Safety");
  await service.sendMessage(id, "Order 100 litres of milk");
  await service.sendMessage(id, "What about making it milk-protein-free?");
  assert.equal(state(service).proposals[0].status, "CANCELLED");
  await service.sendMessage(id, "Restock milk to 30 litres instead");
  assert(state(service).local.threads[0].safetyBlocked);
  await assert.rejects(
    service.createPurchase({ lines: [{ productId: "milk", quantity: 2 }] }, id),
    /dietary requirement/,
  );
  assert.equal(state(service).orders.length, 0);
});

test("overlapping restock plans stay excluded and a later open purchase invalidates an old ready check", async () => {
  const { service } = await setup();
  service.savePlan({
    ...state(service).local.plans[0],
    id: "second-cheese",
    name: "Another cheese target",
  });
  const combined = await service.checkAllPlans();
  assert(
    combined.lines
      .filter((line) => line.productId === "cheese")
      .every((line) => line.state === "partial"),
  );
  const ready = await service.checkPlan("pizza-cheese");
  await service.createPurchase({ lines: [{ productId: "cheese", quantity: 8 }] });
  await assert.rejects(service.prepareRun(ready.id), /open purchase/);
});

test("self role updates refresh UI capability and never retain approver member data", async () => {
  const { service } = await setup();
  await service.createMember({
    username: "another_approver",
    password: "test-only",
    roles: ["approver"],
  });
  await service.updateRoles("anna", ["buyer"]);
  assert.deepEqual(state(service).user.roles, ["buyer"]);
  assert.deepEqual(state(service).members, []);
});
