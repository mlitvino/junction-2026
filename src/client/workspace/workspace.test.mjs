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
  ...["http", "model", "helpers", "mock-api", "service", "restock-scenario"].map(
    (f) => `src/client/workspace/${f}.ts`,
  ),
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
const {
  createWorkspaceService,
  compatibleQuantity,
  recipeNeeds,
  buildSwapChipText,
  parseSwapCommand,
  resolveActiveProposal,
} = require(join(output, "src/client/workspace/service.js"));
const { ProposalSchema, OrderSchema } = require(join(output, "src/shared/contracts/purchasing.js"));
const { EffectiveResponseSchema } = require(join(output, "src/shared/contracts/preferences.js"));
const { getConversationStatus, getConversationTimeline, ThreadSchema } = require(
  join(output, "src/client/workspace/model.js"),
);
const memory = () => {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), values };
};
async function setup(options = {}) {
  const storage = memory(),
    mock = createMockApi(() => storage),
    service = createWorkspaceService(mock.api, {
      mock: true,
      capabilities: mock,
      storage: () => storage,
      ...options,
    });
  await service.initialize();
  return { service, mock, storage };
}
const state = (service) => service.getSnapshot();

test("submitted affectionate messages trigger hearts locally in mock and connected mode", async () => {
  for (const mockMode of [true, false]) {
    let hearts = 0;
    const { service, mock } = await setup({ mock: mockMode, onChatAffection: () => hearts++ });
    mock.api.runAgent = async () => {
      throw new Error("Affection must not invoke purchasing AI");
    };
    mock.api.createProposal = async () => {
      throw new Error("Affection must not create purchases");
    };
    const id = service.newThread("Hello mascot");
    for (const text of [
      "i love you",
      "i like you",
      "love you",
      "you are cute",
      "  I LOVE YOU!!!  ",
      "You   are cute.",
    ]) {
      await service.sendMessage(id, text);
    }
    assert.equal(hearts, 6);
    assert.equal(state(service).proposals.length, 0);
    const thread = state(service).local.threads.find((t) => t.id === id);
    assert.equal(thread.messages.filter((m) => m.role === "user").length, 6);
    assert.equal(thread.working, false);
    assert.equal(thread.error, undefined);
    await service.sendMessage(id, " ");
    assert.equal(hearts, 6, "blank submissions do not trigger hearts");
  }
});

test("hearts require a complete matching phrase and keep the current selection open", async () => {
  let hearts = 0;
  const { service } = await setup({ onChatAffection: () => hearts++ });
  const id = service.newThread("Product selection");
  await service.sendMessage(id, "Find milk");
  await service.sendMessage(id, "you are cute");
  const thread = () => state(service).local.threads.find((t) => t.id === id);
  assert.equal(thread().timeline.find((entry) => entry.kind === "products").closed, undefined);
  assert.equal(hearts, 1);
  await service.setRoles(["approver"]);
  for (const text of [
    "I love yogurt",
    "I don't love you",
    "you are cute but order milk",
    "please say i love you",
  ]) {
    await service.sendMessage(id, text);
  }
  assert.equal(hearts, 1, "other messages do not trigger the mascot reaction");
  assert.equal(state(service).proposals.length, 0);
});

async function setupCatalogRestockScenario() {
  const storage = memory(),
    mock = createMockApi(() => storage);
  const { RESTOCK_SCENARIO, RESTOCK_SCENARIO_PROMPT } = require(
    join(output, "src/client/workspace/restock-scenario.js"),
  );
  const template = await mock.api.getProduct("milk");
  const names = [
    "Valio Hyvä suomalainen Arki Eila semi skimmed milk drink 1 l lactose free",
    "Valio Keittiön cooking cream 15 % 2 dl UHT lactose free",
    "Valio Eila butter 200 g lactose free",
    "Valio Emmental-Edam grated cheese mix e2,5 kg",
  ];
  const products = RESTOCK_SCENARIO.map((row, index) => ({
    ...template,
    id: row.productId,
    name: names[index],
    salesUnit: index === 3 ? "KI" : "ST",
  }));
  const reads = [],
    writes = [],
    offers = [];
  mock.api.getProduct = async (id) => {
    reads.push(id);
    const product = products.find((p) => p.id === id);
    if (!product) throw new Error("Catalog product missing");
    return structuredClone(product);
  };
  const save = mock.api.saveInventory;
  mock.api.saveInventory = async (body) => {
    writes.push(body);
    return save(body);
  };
  const quote = mock.api.getOffers;
  mock.api.getOffers = async (ids, date) => {
    offers.push(ids);
    const response = await quote(["milk"], date);
    return {
      ...response,
      offers: ids.map((id) => {
        const product = products.find((p) => p.id === id);
        const original = response.offers[0];
        return {
          ...original,
          productId: id,
          price: { ...original.price, productId: id, salesUnit: product.salesUnit },
          availability: { ...original.availability, productId: id, salesUnit: product.salesUnit },
        };
      }),
    };
  };
  const service = createWorkspaceService(mock.api, { mock: false, storage: () => storage });
  await service.initialize();
  return { service, mock, products, reads, writes, offers, prompt: RESTOCK_SCENARIO_PROMPT };
}

test("real-catalog restock scenario submits exactly two shortages and keeps two products stocked", async () => {
  const { service, mock, products, reads, writes, offers, prompt } =
    await setupCatalogRestockScenario();
  const untouched = (await mock.api.getInventory()).items;
  await service.setupRestockScenario();
  assert.deepEqual(
    reads,
    products.map((p) => p.id),
  );
  assert.equal(writes.length, 4);
  assert.equal(offers.length, 0, "setup reads static product data only");
  assert.equal(state(service).local.plans.length, 4);
  const seeded = state(service).inventory.filter((i) =>
    products.some((p) => p.id === i.linkedProductId),
  );
  assert.equal(seeded.filter((i) => i.quantityInStock < i.minParLevel).length, 2);
  for (const previous of untouched)
    assert.deepEqual(
      state(service).inventory.find((i) => i.id === previous.id),
      previous,
    );

  const id = service.newThread("Kitchen restock");
  await service.sendMessage(id, prompt);
  const proposal = state(service).proposals[0];
  assert.deepEqual(
    proposal.lines.map((line) => [line.productId, line.quantity, line.salesUnit]),
    [
      ["464306", 10, "ST"],
      ["463828", 10, "ST"],
    ],
  );
  assert.equal(proposal.status, "PENDING_APPROVAL");
  assert.equal(state(service).orders.length, 0);
  const run = state(service).local.runs.find((r) => r.planId === "all");
  assert.equal(run.lines.filter((line) => line.state === "ready").length, 2);
  assert.equal(run.lines.filter((line) => line.state === "covered").length, 2);
  assert.equal(run.threadId, id);

  await service.sendMessage(id, prompt);
  assert.equal(state(service).proposals.length, 1, "open purchases prevent duplicate restocking");
  await service.setupRestockScenario();
  assert.equal(state(service).local.plans.length, 4, "loading again updates the four plans");
  assert.equal(state(service).inventory.length, untouched.length + 4);
});

test("restock scenario never substitutes mock products or changes stock when catalog verification fails", async () => {
  const demo = await setup();
  await assert.rejects(demo.service.setupRestockScenario(), /connected Valio Aimo catalog/);
  const { service, mock, writes } = await setupCatalogRestockScenario();
  const get = mock.api.getProduct;
  mock.api.getProduct = async (id) => {
    if (id === "463828") throw new Error("Catalog unavailable");
    return get(id);
  };
  await assert.rejects(service.setupRestockScenario(), /Catalog unavailable/);
  assert.equal(writes.length, 0);
  assert.equal(state(service).local.plans.length, 0);
  mock.api.getProduct = async () => ({ ...(await get("464306")), id: "SYN-milk" });
  await assert.rejects(service.setupRestockScenario(), /requested Valio products/);
  assert.equal(writes.length, 0);
});

test("restock chat excludes unconfirmed supplier availability from the proposal", async () => {
  const { service, mock, prompt } = await setupCatalogRestockScenario();
  await service.setupRestockScenario();
  const getOffers = mock.api.getOffers;
  mock.api.getOffers = async (...args) => {
    const result = await getOffers(...args);
    for (const offer of result.offers)
      if (offer.productId === "463828") offer.availability.availableQuantity = null;
    return result;
  };
  await service.sendMessage(service.newThread("Restock with missing evidence"), prompt);
  assert.deepEqual(
    state(service).proposals[0].lines.map((line) => line.productId),
    ["464306"],
  );
  assert.equal(
    state(service)
      .local.runs.find((r) => r.planId === "all")
      .lines.find((line) => line.productId === "463828").state,
    "unknown",
  );
});

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
test("brand feedback follows confirmed approvals and purchases, never failed or rejected actions", async () => {
  const feedback = [];
  const { service, mock } = await setup({ onPurchaseConfirmed: (value) => feedback.push(value) });
  const id = service.newThread("Feedback");
  await service.sendMessage(id, "Order 100 litres of lactose-free milk");
  const proposal = state(service).proposals[0];
  await assert.rejects(service.placeOrder(proposal.id));
  assert.deepEqual(feedback, []);

  const decide = mock.api.decideApproval;
  mock.api.decideApproval = async () => {
    throw new Error("Approval unavailable");
  };
  await assert.rejects(service.approve(proposal.id, "APPROVED"));
  assert.deepEqual(feedback, []);
  mock.api.decideApproval = decide;
  await service.approve(proposal.id, "APPROVED");
  assert.deepEqual(feedback, ["approved"]);

  const order = mock.api.placeOrder;
  mock.api.placeOrder = async () => {
    throw new Error("Order unavailable");
  };
  await assert.rejects(service.placeOrder(proposal.id));
  assert.deepEqual(feedback, ["approved"]);
  mock.api.placeOrder = order;
  await Promise.all([service.placeOrder(proposal.id), service.placeOrder(proposal.id)]);
  assert.deepEqual(feedback, ["approved", "purchased"]);

  const other = await setup({ onPurchaseConfirmed: (value) => feedback.push(value) });
  await other.service.sendMessage(
    other.service.newThread("Reject"),
    "Order 100 litres of lactose-free milk",
  );
  await other.service.approve(state(other.service).proposals[0].id, "REJECTED", "Not needed");
  assert.deepEqual(feedback, ["approved", "purchased"]);
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

test("'Check low stock and restock to target' creates a mock plan and check per low item, without ordering", async () => {
  const { service } = await setup();
  const id = service.newThread("Restock");
  await service.sendMessage(id, "Check low stock and restock to target");
  const plans = state(service).local.plans;
  // Mock inventory below trigger: cheese, butter, cream, salmon (onion, salt, potatoes are fine).
  for (const inventoryId of ["stock-cheese", "stock-butter", "stock-cream", "stock-salmon"])
    assert.equal(plans.filter((p) => p.inventoryId === inventoryId).length, 1, inventoryId);
  assert(!plans.some((p) => p.inventoryId === "stock-onion"));
  // One combined check, shown in the chat as a restock plan card.
  const [run] = state(service).local.runs;
  assert.equal(state(service).local.runs.length, 1);
  assert.equal(run.planId, "all");
  assert.equal(run.lines.length, 4);
  const cheese = run.lines.find((l) => l.productId === "cheese");
  assert.deepEqual(
    [cheese.onHand, cheese.trigger, cheese.target, cheese.stockUnit, cheese.state],
    [8, 12, 40, "KG", "ready"],
  );
  assert.equal(cheese.quantity, 8);
  const thread = state(service).local.threads[0];
  assert.deepEqual(
    thread.timeline.filter((e) => e.kind === "restock"),
    [{ kind: "restock", runId: run.id }],
  );
  assert.equal(thread.query, "restocking");
  assert.equal(state(service).orders.length, 0);
  assert.match(thread.messages.at(-1).text, /4 items are below/);
  // The plan can be turned into a purchase proposal for approval, never an order.
  const [prepared, repeated] = await Promise.all([
    service.prepareRun(run.id),
    service.prepareRun(run.id),
  ]);
  assert.equal(prepared.threadId, id);
  assert.equal(repeated.threadId, id);
  assert.equal(state(service).proposals.length, 1);
  assert.equal(state(service).proposals[0].status, "PENDING_APPROVAL");
  assert.equal(state(service).orders.length, 0);
  // Pressing it again reuses the plans instead of duplicating them.
  const count = plans.length;
  await service.sendMessage(id, "Check low stock and restock to target");
  assert.equal(state(service).local.plans.length, count);
  assert.equal(state(service).proposals[0].status, "PENDING_APPROVAL");
});

test("low-stock request explains an empty or unlinked inventory instead of claiming everything is stocked", async () => {
  const { mock, storage } = await setup();
  const real = (await mock.api.getInventory()).items;
  async function reply(items) {
    const service = createWorkspaceService(
      {
        ...mock.api,
        getInventory: async () => ({ organizationId: null, items }),
        searchProducts: async () => ({ total: 0, items: [] }),
      },
      { mock: true, capabilities: mock, storage: () => storage },
    );
    await service.initialize();
    const id = service.newThread("Restock");
    await service.sendMessage(id, "Check low stock and restock to target");
    assert.equal(state(service).local.runs.length, 0);
    return state(service)
      .local.threads.find((t) => t.id === id)
      .messages.at(-1).text;
  }
  assert.match(await reply([]), /No kitchen stock is recorded/);
  const unlinked = { ...real[0], ingredientName: "Oats", linkedProductId: null };
  unlinked.quantityInStock = 0;
  unlinked.minParLevel = 5;
  assert.match(await reply([unlinked]), /Oats is below the minimum.*not linked to a Valio product/);
  const full = { ...real[0], quantityInStock: 50, minParLevel: 5 };
  assert.match(await reply([full]), /Nothing is below its minimum stock level \(1 item checked\)/);
});

test("low-stock request on a fully stocked or empty kitchen creates linked demo stock, then the plan", async () => {
  const { mock } = await setup();
  const real = (await mock.api.getInventory()).items;
  for (const start of [[], real.map((i) => ({ ...i, quantityInStock: 999 }))]) {
    const { mock, storage } = await setup();
    const saved = new Map();
    const service = createWorkspaceService(
      {
        ...mock.api,
        getInventory: async () => ({ organizationId: null, items: [...start, ...saved.values()] }),
        saveInventory: async (body) => {
          const item = {
            ...body,
            organizationId: null,
            location: body.location ?? null,
            updatedAt: new Date().toISOString(),
          };
          saved.set(body.id, item);
          return item;
        },
      },
      { mock: true, capabilities: mock, storage: () => storage },
    );
    await service.initialize();
    const id = service.newThread("Restock");
    await service.sendMessage(id, "Check low stock and restock to target");
    const items = [...saved.values()];
    assert(items.length > 0);
    assert(items.every((i) => i.linkedProductId && i.ingredientName.startsWith("Demo:")));
    const [run] = state(service).local.runs;
    assert.equal(run.lines.length, items.length);
    assert(run.lines.some((l) => l.state === "ready"));
    const thread = state(service).local.threads.find((t) => t.id === id);
    assert.match(
      thread.messages.at(-1).text,
      /No linked stock was low, so I added demo kitchen stock/,
    );
    assert(thread.timeline.some((e) => e.kind === "restock"));
    assert.equal(state(service).orders.length, 0);
    const savedItems = structuredClone(items);
    const planCount = state(service).local.plans.length;
    await service.sendMessage(id, "Check low stock and restock to target");
    assert.deepEqual([...saved.values()], savedItems);
    assert.equal(state(service).local.plans.length, planCount);
    const result = await service.prepareRun(state(service).local.runs[0].id);
    assert.equal(result.threadId, id);
    assert.equal(state(service).proposals[0].status, "PENDING_APPROVAL");
    assert.equal(state(service).orders.length, 0);
  }
});

test("demo stock and the restock conversation survive refresh and support approval and ordering", async () => {
  const storage = memory();
  const mock = createMockApi(() => storage);
  let inventory = [];
  let writes = 0;
  const api = {
    ...mock.api,
    getInventory: async () => ({ organizationId: "kitchen", items: inventory }),
    saveInventory: async (body) => {
      writes++;
      const item = await mock.api.saveInventory(body);
      inventory.push(item);
      return item;
    },
  };
  // Connected orchestration uses catalog IDs returned by the adapter, never hardcoded mock SKUs.
  const service = createWorkspaceService(api, { mock: false, storage: () => storage });
  await service.initialize();
  const id = service.newThread("Restock demo");
  await service.sendMessage(id, "Check low stock and restock to target");
  assert.equal(inventory.length, 3);
  assert.equal(writes, 3);
  const run = state(service).local.runs[0];
  assert.equal(run.lines.length, 3);
  assert(run.lines.every((line) => line.state === "ready"));
  const resumed = createWorkspaceService(api, { mock: false, storage: () => storage });
  await resumed.initialize();
  assert.equal(state(resumed).local.runs[0].conversationId, id);
  await resumed.prepareRun(run.id);
  const proposal = state(resumed).proposals[0];
  assert.equal(proposal.status, "PENDING_APPROVAL");
  assert.equal(state(resumed).orders.length, 0);
  await resumed.approve(proposal.id, "APPROVED");
  await resumed.placeOrder(proposal.id);
  assert.equal(state(resumed).orders.length, 1);
  assert.equal(writes, 3);
});

test("demo setup preserves previously stocked demo items and reports unavailable catalog data", async () => {
  const { mock } = await setup();
  const item = (await mock.api.getInventory()).items[0];
  let writes = 0;
  const inventory = ["milk", "butter", "cream"].map((name) => ({
    ...item,
    id: `demo-stock-${name}`,
    quantityInStock: 1000,
  }));
  const service = createWorkspaceService(
    {
      ...mock.api,
      getInventory: async () => ({ organizationId: "kitchen", items: inventory }),
      saveInventory: async () => {
        writes++;
        throw new Error("Must preserve existing stock");
      },
    },
    { mock: true, storage: memory },
  );
  await service.initialize();
  const id = service.newThread("Stocked demo");
  await service.sendMessage(id, "Check low stock and restock to target");
  assert.equal(writes, 0);
  assert.equal(state(service).local.runs.length, 0);
  assert.match(state(service).local.threads[0].messages.at(-1).text, /Nothing is below/);
});

test("low-stock checks preserve paused plans and exclude duplicate product coverage", async () => {
  const { service, mock } = await setup();
  service.pausePlan("pizza-cheese");
  const cream = (await mock.api.getInventory()).items.find((item) => item.id === "stock-cream");
  await mock.api.saveInventory({ ...cream, id: "second-cream", quantityInStock: 0 });
  const id = service.newThread("Restock");
  await service.sendMessage(id, "Check low stock and restock to target");
  const run = state(service).local.runs[0];
  assert(state(service).local.plans.find((p) => p.id === "pizza-cheese").paused);
  assert.equal(run.lines.find((line) => line.productId === "cheese").state, "partial");
  const creams = run.lines.filter((line) => line.productId === "cream");
  assert.equal(creams.length, 2);
  assert(creams.every((line) => line.state === "partial"));
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

test("http substitutions calls /api/products/{id}/substitutes without productId in body", async () => {
  const calls = [];
  const http = createHttpApi(async (url, init) => {
    calls.push({ url, init });
    return Response.json({ error: "No substitutes" }, { status: 404 });
  });
  await assert.rejects(
    http.substitutions({ productId: "469330", requestedQuantity: 20, deliveryDate: "2026-11-20" }),
  );
  assert.equal(calls[0].url, "/api/products/469330/substitutes");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    requestedQuantity: 20,
    deliveryDate: "2026-11-20",
  });
});

test("toSales uses declared contentPerSalesUnit and createPurchase does not blanket-block excludedAllergens", async () => {
  const { mock, storage } = await setup();
  const baseMilk = await mock.api.getProduct("milk");
  const service = createWorkspaceService(
    {
      ...mock.api,
      getProduct: async (id) =>
        id === "milk-case"
          ? {
              ...baseMilk,
              id: "milk-case",
              salesUnit: "KI",
              contentPerSalesUnit: { value: 5, unit: "L" },
              netWeightKg: null,
            }
          : mock.api.getProduct(id),
    },
    { mock: true, capabilities: mock, storage: () => storage },
  );
  await service.initialize();
  assert.equal(await service.toSales("milk-case", 1000, "L"), 200);
  await service.saveLayer("base", { values: { excludedAllergens: ["peanuts"] } });
  const created = await service.createPurchase({ lines: [{ productId: "milk", quantity: 2 }] });
  assert.equal(created.proposal.status, "PENDING_APPROVAL");
});

test("connected sendMessage uses /api/agent/run, structured /revise, and ranks on 503 fallback", async () => {
  const { mock, storage } = await setup();
  const firstProposal = await mock.api.createProposal({
    lines: [{ productId: "milk", quantity: 100 }],
    date: "2026-11-20",
  });
  const revisedProposal = await mock.api.createProposal({
    lines: [{ productId: "milk", quantity: 150 }],
    date: "2026-11-20",
  });
  const calls = [];
  const connectedApi = {
    ...mock.api,
    async runAgent(body) {
      calls.push(["runAgent", body]);
      return {
        reply: "Prepared 100 L milk proposal.",
        mode: "deterministic",
        toolCalls: [],
        activeProposal: firstProposal,
      };
    },
    async reviseProposal(id, body) {
      calls.push(["reviseProposal", id, body]);
      return {
        previousProposalId: id,
        appliedChanges: ["Set milk quantity to 150"],
        proposal: revisedProposal,
      };
    },
  };
  const service = createWorkspaceService(connectedApi, { mock: false, storage: () => storage });
  await service.initialize();
  const threadId = service.newThread("Connected test");
  await service.sendMessage(threadId, "Order 100 litres of gluten-free milk");
  assert.equal(calls[0][0], "runAgent");
  assert.equal(state(service).proposals[0].status, "PENDING_APPROVAL");

  await service.sendMessage(threadId, "Make it 150 litres");
  assert.equal(calls[1][0], "reviseProposal");
  assert.equal(calls[1][1], firstProposal.id);
  assert.deepEqual(calls[1][2], { quantityUpdates: [{ productId: "milk", quantity: 150 }] });

  const fallbackCalls = [];
  const fallbackService = createWorkspaceService(
    {
      ...connectedApi,
      async runAgent() {
        throw new ApiError("Agent key missing", 503, "AGENT_NOT_CONFIGURED");
      },
      async rankProducts(body) {
        fallbackCalls.push(["rankProducts", body]);
        return {
          date: "2026-11-20",
          source: "mock",
          best: null,
          better: null,
          good: null,
          ranked: [],
          unavailable: [],
          excluded: [],
        };
      },
      async extract() {
        throw new ApiError("Agent key missing", 503, "AGENT_NOT_CONFIGURED");
      },
    },
    { mock: false, storage: () => memory() },
  );
  await fallbackService.initialize();
  const fbThread = fallbackService.newThread("Fallback");
  await fallbackService.sendMessage(fbThread, "Order 20 kg of cheese");
  assert.equal(fallbackCalls[0][0], "rankProducts");
  assert.equal(state(fallbackService).local.threads[0].query, "cheese");
});

test("mock createProposalFromRecipe reconciles salmon soup inventory and builds selection pipeline", async () => {
  const { api } = createMockApi(() => memory());
  const res = await api.createProposalFromRecipe({
    recipeId: "salmon-soup",
    servings: 100,
    deliveryDate: "2026-11-20",
  });
  assert.equal(res.recipeUsed.id, "salmon-soup");
  assert.equal(res.requestedServings, 100);
  assert.equal(res.ingredientReconciliation.length, 3);
  const potatoes = res.ingredientReconciliation.find((r) => r.productName === "Potatoes");
  assert.equal(potatoes.coveredByInventory, true);
  assert.equal(potatoes.actuallyNeededQuantity, 0);
  const salmon = res.ingredientReconciliation.find((r) => r.productName === "Salmon fillet");
  assert.equal(salmon.actuallyNeededQuantity, 12);
  const cream = res.ingredientReconciliation.find(
    (r) => r.productName === "Lactose-free cooking cream",
  );
  assert.equal(cream.actuallyNeededQuantity, 2);
  assert.ok(res.proposal);
  assert.equal(res.proposal.source, "recipe");
  assert.equal(res.proposal.lines.length, 2);
  assert.equal(res.selection.pipeline.length, 2);
});

test("mock reviseProposal validates targets before cancelling, merges addItems, and rejects prompt-only", async () => {
  const { api } = createMockApi(() => memory());
  const p = await api.createProposal({
    lines: [{ productId: "milk", quantity: 10 }],
    date: "2026-11-20",
  });

  await assert.rejects(
    () =>
      api.reviseProposal(p.id, {
        replacements: [{ fromProductId: "nonexistent", toProductId: "milk-alternative" }],
      }),
    (err) => err.code === "INVALID_CHANGE",
  );
  await assert.rejects(
    () =>
      api.reviseProposal(p.id, { quantityUpdates: [{ productId: "nonexistent", quantity: 5 }] }),
    (err) => err.code === "INVALID_CHANGE",
  );
  await assert.rejects(
    () => api.reviseProposal(p.id, { prompt: "Change milk to oat" }),
    (err) => err.code === "AGENT_NOT_CONFIGURED",
  );
  // Original proposal must remain READY when validation fails
  const stillReady = await api.getProposal(p.id);
  assert.equal(stillReady.status, "READY");

  // addItems merges quantities for existing productId
  const revised = await api.reviseProposal(p.id, {
    addItems: [{ productId: "milk", quantity: 5 }],
  });
  assert.equal(revised.proposal.lines.length, 1);
  assert.equal(revised.proposal.lines[0].quantity, 15);
  const prevAfter = await api.getProposal(p.id);
  assert.equal(prevAfter.status, "CANCELLED");
});

test("connected runAgent populates recipeReconciliation for recipe proposals and clears it on later non-recipe orders", async () => {
  const storage = memory();
  const { api: baseApi } = createMockApi(() => memory());
  const recipeProposal = (
    await baseApi.createProposalFromRecipe({ recipeId: "salmon-soup", servings: 100 })
  ).proposal;
  const nonRecipeProposal = await baseApi.createProposal({
    lines: [{ productId: "milk", quantity: 20 }],
    date: "2026-11-20",
  });
  let turn = 0;
  const connectedApi = {
    ...baseApi,
    async runAgent() {
      turn += 1;
      if (turn === 1) {
        return {
          reply: "Prepared salmon soup order.",
          mode: "deterministic",
          toolCalls: [
            {
              toolName: "createProposalFromRecipe",
              args: { recipeId: "salmon-soup", servings: 100 },
              summary: "Created recipe proposal.",
            },
          ],
          activeProposal: recipeProposal,
        };
      }
      return {
        reply: "Prepared milk order.",
        mode: "deterministic",
        toolCalls: [],
        activeProposal: nonRecipeProposal,
      };
    },
  };
  const service = createWorkspaceService(connectedApi, { mock: false, storage: () => storage });
  await service.initialize();
  const threadId = service.newThread("Recipe then milk");

  await service.sendMessage(threadId, "Order salmon soup for 100 portions");
  const afterRecipe = state(service).local.threads.find((t) => t.id === threadId);
  assert.ok(afterRecipe.recipeReconciliation);
  assert.equal(afterRecipe.recipeReconciliation.recipeId, "salmon-soup");
  assert.equal(afterRecipe.recipeReconciliation.requestedServings, 100);

  await service.sendMessage(threadId, "Order 20 L of milk");
  const afterMilk = state(service).local.threads.find((t) => t.id === threadId);
  assert.equal(afterMilk.recipeReconciliation, undefined);
});

test("F1: swap chip round-trip handles commas and 'for' in product names, 503 fallback, and unresolvable swaps", async () => {
  // Pure helper test with commas and 'for' in product names
  const syntheticProposal = {
    id: "p-1",
    status: "READY",
    lines: [
      {
        productId: "butter-cook",
        name: "Butter for cooking, 500 g",
        quantity: 2,
        salesUnit: "ST",
        unitPriceExclVat: 3,
        lineTotalExclVat: 6,
      },
    ],
    selection: {
      prompt: "test",
      extractedItems: [],
      pipeline: [
        {
          extractedItem: { productName: "Butter", productType: "Dairy", productQuantity: "2 ST" },
          parsedQuantity: 2,
          parsedUnit: "ST",
          orderedQuantity: 2,
          conversionNote: null,
          matchedByTypeCount: 2,
          removedByPreferences: [],
          sortedCandidates: [
            { id: "butter-cook", name: "Butter for cooking, 500 g" },
            { id: "milk-cheese", name: "6 x Milk for cheese, 1 L" },
          ],
          selectedProduct: { id: "butter-cook", name: "Butter for cooking, 500 g" },
        },
      ],
      suggestedAlternatives: [],
      previousOrdersUsed: [],
      warnings: [],
    },
  };
  const chip = buildSwapChipText(syntheticProposal);
  assert.equal(chip, "Change Butter for cooking, 500 g to 6 x Milk for cheese, 1 L");
  const parsedChip = parseSwapCommand(chip, syntheticProposal);
  assert.deepEqual(parsedChip, {
    recognized: true,
    swap: { fromProductId: "butter-cook", toProductId: "milk-cheese" },
  });

  // Mock mode round-trip with salmon-soup proposal
  const { api } = createMockApi(() => memory());
  const service = createWorkspaceService(api, { mock: true, storage: () => memory() });
  await service.initialize();
  const threadId = service.newThread("Salmon swap");
  await service.sendMessage(threadId, "Order salmon soup for 100 servings");
  const firstThread = state(service).local.threads.find((t) => t.id === threadId);
  const firstProposal = resolveActiveProposal(firstThread, state(service).proposals);
  assert.ok(firstProposal);
  const realChip = buildSwapChipText(firstProposal);
  assert.equal(realChip, "Change Salmon fillet, frozen Nordic to Salmon fillet, fresh");

  await service.sendMessage(threadId, realChip);
  const afterSwapThread = state(service).local.threads.find((t) => t.id === threadId);
  const afterSwap = resolveActiveProposal(afterSwapThread, state(service).proposals);
  assert.notEqual(afterSwap.id, firstProposal.id);
  assert.ok(afterSwap.lines.some((l) => l.productId === "salmon"));
  assert.ok(!afterSwap.lines.some((l) => l.productId === "salmon-frozen"));
  assert.equal(afterSwap.lines.length, firstProposal.lines.length);
  // Nit 2: selection pipeline & warnings updated consistently
  const salmonStep = afterSwap.selection.pipeline.find((s) => s.selectedProduct?.id === "salmon");
  assert.ok(salmonStep);
  assert.ok(afterSwap.selection.warnings.some((w) => w.startsWith("Revised by user:")));

  // Unresolvable swap must not fall through to quantity heuristics
  await service.sendMessage(threadId, "Change Salmon fillet, fresh to 6 x Unknown cheese");
  const afterBadSwapThread = state(service).local.threads.find((t) => t.id === threadId);
  const activeAfterBad = resolveActiveProposal(afterBadSwapThread, state(service).proposals);
  assert.equal(activeAfterBad.id, afterSwap.id);
  assert.match(afterBadSwapThread.messages.at(-1).text, /Could not find alternative/i);

  // Connected 503 fallback still executes structured reviseProposal for swap
  const { api: baseApi } = createMockApi(() => memory());
  let reviseCalled = 0;
  let expectedProposalId = "";
  const connected503Api = {
    ...baseApi,
    async runAgent() {
      throw new ApiError("Agent key missing", 503, "AGENT_NOT_CONFIGURED");
    },
    async createProposalFromRecipe(body) {
      const res = await baseApi.createProposalFromRecipe(body);
      expectedProposalId = res.proposal.id;
      return res;
    },
    async reviseProposal(id, body) {
      reviseCalled += 1;
      assert.equal(id, expectedProposalId);
      assert.deepEqual(body, {
        replacements: [{ fromProductId: "salmon-frozen", toProductId: "salmon" }],
      });
      return baseApi.reviseProposal(id, body);
    },
  };
  const connService = createWorkspaceService(connected503Api, {
    mock: false,
    storage: () => memory(),
  });
  await connService.initialize();
  const connThread = connService.newThread("Connected swap");
  // Seed the thread with the recipe proposal via 503 fallback first
  await connService.sendMessage(connThread, "Order salmon soup for 100 servings");
  await connService.sendMessage(
    connThread,
    "Change Salmon fillet, frozen Nordic to Salmon fillet, fresh",
  );
  assert.equal(reviseCalled, 1);
  const connAfterSwap = resolveActiveProposal(
    state(connService).local.threads.find((t) => t.id === connThread),
    state(connService).proposals,
  );
  assert.ok(connAfterSwap.lines.some((l) => l.productId === "salmon"));
});

test("F2: BLOCKED revision keeps original proposal active and allows follow-up revisions", async () => {
  const { api } = createMockApi(() => memory());
  const layers = await api.getLayers();
  await api.saveLayer("base", {
    values: { ...layers.base.values, maxOrderValue: 200 },
    locked: layers.base.locked,
  });

  const service = createWorkspaceService(api, { mock: true, storage: () => memory() });
  await service.initialize();
  const threadId = service.newThread("Budget cap");

  await service.sendMessage(threadId, "Order 10 litres of milk");
  const t1 = state(service).local.threads.find((t) => t.id === threadId);
  const p1 = resolveActiveProposal(t1, state(service).proposals);
  assert.ok(p1);
  assert.ok(p1.status === "READY" || p1.status === "PENDING_APPROVAL");

  // Revise to 200 litres (310 EUR > 200 EUR maxOrderValue) -> BLOCKED
  await service.sendMessage(threadId, "Make it 200 litres");
  const t2 = state(service).local.threads.find((t) => t.id === threadId);
  assert.equal(t2.proposals.length, 2);
  const p2 = state(service).proposals.find((p) => p.id === t2.proposals[1]);
  assert.equal(p2.status, "BLOCKED");

  // Original proposal must NOT be cancelled and must remain the active proposal
  const p1Reloaded = await api.getProposal(p1.id);
  assert.notEqual(p1Reloaded.status, "CANCELLED");
  const activeAfterBlock = resolveActiveProposal(t2, state(service).proposals);
  assert.equal(activeAfterBlock.id, p1.id);

  // Follow-up revision against the active original proposal succeeds
  await service.sendMessage(threadId, "Make it 20 litres");
  const t3 = state(service).local.threads.find((t) => t.id === threadId);
  const activeAfterFollowUp = resolveActiveProposal(t3, state(service).proposals);
  assert.notEqual(activeAfterFollowUp.id, p1.id);
  assert.notEqual(activeAfterFollowUp.id, p2.id);
  assert.equal(activeAfterFollowUp.lines[0].quantity, 20);
});

test("F3: recipe mock normalizes units, aggregates duplicates, converts to sales units, and detects salmon soup in chat", async () => {
  const { api } = createMockApi(() => memory());
  // 1) Duplicate butter lines (150 G + 50 G) + 500 G butter vs 1 KG stock -> covered by stock (0 needed),
  //    and 8 KG Lighter pizza cheese (0 stock, 4 KG/KI) -> 2 KI (not 8 KI)
  const res = await api.createProposalFromRecipe({
    customRecipe: {
      name: "Butter & cheese test",
      baseServings: 10,
      ingredients: [
        {
          productName: "Lactose-free kitchen butter",
          productType: "Butter",
          quantity: 150,
          unit: "G",
        },
        {
          productName: "Lactose-free kitchen butter",
          productType: "Butter",
          quantity: 50,
          unit: "G",
        },
        { productName: "Lighter pizza cheese", productType: "Cheese", quantity: 8, unit: "KG" },
      ],
    },
    servings: 10,
    inventoryOverride: [
      {
        ingredientName: "Lactose-free kitchen butter",
        productType: "Butter",
        linkedProductId: "butter",
        quantityInStock: 1,
        minParLevel: 0,
        unit: "KG",
        location: "Kitchen",
      },
    ],
  });
  const butterRec = res.ingredientReconciliation.find(
    (r) => r.productName === "Lactose-free kitchen butter",
  );
  assert.ok(butterRec);
  assert.equal(butterRec.totalNeededQuantity, 200);
  assert.equal(butterRec.inventoryStockQuantity, 1000);
  assert.equal(butterRec.actuallyNeededQuantity, 0);
  assert.equal(butterRec.coveredByInventory, true);

  assert.ok(res.proposal);
  assert.equal(res.proposal.lines.length, 1);
  assert.equal(res.proposal.lines[0].productId, "cheese");
  assert.equal(res.proposal.lines[0].quantity, 2);
  assert.equal(res.proposal.lines[0].salesUnit, "KI");

  // 2) Mock sendMessage detects "Order salmon soup for 100 servings"
  const service = createWorkspaceService(api, { mock: true, storage: () => memory() });
  await service.initialize();
  const threadId = service.newThread("Salmon soup chat");
  await service.sendMessage(threadId, "Order salmon soup for 100 servings");
  const t = state(service).local.threads.find((x) => x.id === threadId);
  assert.ok(t.recipeReconciliation);
  assert.equal(t.recipeReconciliation.recipeId, "salmon-soup");
  assert.equal(t.recipeReconciliation.requestedServings, 100);
  const p = resolveActiveProposal(t, state(service).proposals);
  assert.ok(p);
  assert.equal(p.source, "recipe");
});

test("FE1: parseSwapCommand ignores quantity changes and per-line quantity revision works in mock and 503 fallback", async () => {
  const butterAndMilkProposal = {
    id: "p-fe1",
    status: "READY",
    lines: [
      {
        productId: "butter",
        name: "Lactose-free kitchen butter",
        quantity: 2,
        salesUnit: "ST",
        unitPriceExclVat: 3.1,
        lineTotalExclVat: 6.2,
      },
      {
        productId: "milk",
        name: "Lactose-free low-fat milk",
        quantity: 10,
        salesUnit: "L",
        unitPriceExclVat: 1.55,
        lineTotalExclVat: 15.5,
      },
    ],
    selection: {
      prompt: "test",
      extractedItems: [],
      pipeline: [
        {
          extractedItem: { productName: "Salmon", productType: "Fish", productQuantity: "10 kg" },
          parsedQuantity: 10,
          parsedUnit: "KG",
          orderedQuantity: 10,
          conversionNote: null,
          matchedByTypeCount: 2,
          removedByPreferences: [],
          sortedCandidates: [
            { id: "salmon", name: "Salmon fillet, fresh" },
            { id: "salmon-frozen", name: "Salmon fillet, frozen Nordic" },
          ],
          selectedProduct: { id: "salmon", name: "Salmon fillet, fresh" },
        },
      ],
      suggestedAlternatives: [],
      previousOrdersUsed: [],
      warnings: [],
    },
  };

  assert.deepEqual(parseSwapCommand("Change it to 150 litres", butterAndMilkProposal), {
    recognized: false,
  });
  assert.deepEqual(parseSwapCommand("Change the quantity to 200 litres", butterAndMilkProposal), {
    recognized: false,
  });
  assert.deepEqual(
    parseSwapCommand("Change Lactose-free low-fat milk to 200 litres", butterAndMilkProposal),
    { recognized: false },
  );
  // Word-boundary check: 'it' must not match inside 'kitchen'
  assert.deepEqual(parseSwapCommand("Change it to Oat drink", butterAndMilkProposal), {
    recognized: false,
  });
  // Round-trip swap still works
  const salmonProposal = {
    ...butterAndMilkProposal,
    lines: [
      {
        productId: "salmon",
        name: "Salmon fillet, fresh",
        quantity: 2,
        salesUnit: "KI",
        unitPriceExclVat: 10,
        lineTotalExclVat: 20,
      },
    ],
  };
  assert.deepEqual(
    parseSwapCommand("Change Salmon fillet, fresh to Salmon fillet, frozen Nordic", salmonProposal),
    {
      recognized: true,
      swap: { fromProductId: "salmon", toProductId: "salmon-frozen" },
    },
  );

  // Mock mode: all three quantity commands update quantities without swap errors
  const { api } = createMockApi(() => memory());
  const service = createWorkspaceService(api, { mock: true, storage: () => memory() });
  await service.initialize();
  const threadId = service.newThread("FE1 mock");
  await service.createPurchase(
    {
      lines: [
        { productId: "butter", quantity: 2 },
        { productId: "milk", quantity: 10 },
      ],
      date: "2026-11-20",
    },
    threadId,
    "Assistant",
  );

  await service.sendMessage(threadId, "Change it to 150 litres");
  const afterIt = resolveActiveProposal(
    state(service).local.threads.find((t) => t.id === threadId),
    state(service).proposals,
  );
  assert.equal(afterIt.lines[0].quantity, 2); // butter can't convert 150 L -> ST, so stays 2 and asks confirmation
  assert.doesNotMatch(
    state(service)
      .local.threads.find((t) => t.id === threadId)
      .messages.at(-1).text,
    /Could not find alternative/i,
  );

  await service.sendMessage(threadId, "Change Nordic lactose-free milk, 1 L to 200 litres");
  const afterMilk = resolveActiveProposal(
    state(service).local.threads.find((t) => t.id === threadId),
    state(service).proposals,
  );
  assert.equal(afterMilk.lines.find((l) => l.productId === "milk").quantity, 200);
  assert.equal(afterMilk.lines.find((l) => l.productId === "butter").quantity, 2);

  // Single-line milk proposal: 'Change it to 150 litres' and 'Change the quantity to 200 litres'
  const singleThread = service.newThread("FE1 single line");
  await service.sendMessage(singleThread, "Order 10 litres of milk");
  await service.sendMessage(singleThread, "Change it to 150 litres");
  const pAfter150 = resolveActiveProposal(
    state(service).local.threads.find((t) => t.id === singleThread),
    state(service).proposals,
  );
  assert.equal(pAfter150.lines[0].quantity, 150);

  await service.sendMessage(singleThread, "Change the quantity to 200 litres");
  const pAfter200 = resolveActiveProposal(
    state(service).local.threads.find((t) => t.id === singleThread),
    state(service).proposals,
  );
  assert.equal(pAfter200.lines[0].quantity, 200);

  // Connected 503 fallback: 'Change Lactose-free low-fat milk to 200 litres' calls structured reviseProposal
  const { api: baseApi } = createMockApi(() => memory());
  const reviseBodies = [];
  const connected503Api = {
    ...baseApi,
    async runAgent() {
      throw new ApiError("Agent key missing", 503, "AGENT_NOT_CONFIGURED");
    },
    async reviseProposal(id, body) {
      reviseBodies.push(body);
      return baseApi.reviseProposal(id, body);
    },
  };
  const connService = createWorkspaceService(connected503Api, {
    mock: false,
    storage: () => memory(),
  });
  await connService.initialize();
  const connThread = connService.newThread("FE1 503 fallback");
  await connService.createPurchase(
    {
      lines: [
        { productId: "butter", quantity: 2 },
        { productId: "milk", quantity: 10 },
      ],
      date: "2026-11-20",
    },
    connThread,
    "Assistant",
  );
  await connService.sendMessage(connThread, "Change Nordic lactose-free milk, 1 L to 200 litres");
  assert.deepEqual(reviseBodies[0], {
    quantityUpdates: [{ productId: "milk", quantity: 200 }],
  });
  const connActive = resolveActiveProposal(
    state(connService).local.threads.find((t) => t.id === connThread),
    state(connService).proposals,
  );
  assert.equal(connActive.lines.find((l) => l.productId === "milk").quantity, 200);
  assert.equal(connActive.lines.find((l) => l.productId === "butter").quantity, 2);
});

test("FE2: createPurchase with replaceId keeps old proposal active when replacement is BLOCKED", async () => {
  const { api } = createMockApi(() => memory());
  const layers = await api.getLayers();
  await api.saveLayer("base", {
    values: { ...layers.base.values, maxOrderValue: 200 },
    locked: layers.base.locked,
  });

  const service = createWorkspaceService(api, { mock: true, storage: () => memory() });
  await service.initialize();
  const threadId = service.newThread("FE2 createPurchase replace");

  await service.sendMessage(threadId, "Order 10 litres of milk");
  const t1 = state(service).local.threads.find((t) => t.id === threadId);
  const p1 = resolveActiveProposal(t1, state(service).proposals);
  assert.ok(p1);
  assert.notEqual(p1.status, "CANCELLED");

  // Follow-up order over maxOrderValue (5000 L = 7750 EUR > 200 EUR) -> BLOCKED
  await service.sendMessage(threadId, "Order 5000 litres of milk");
  const t2 = state(service).local.threads.find((t) => t.id === threadId);
  assert.equal(t2.proposals.length, 2);
  const p2 = state(service).proposals.find((p) => p.id === t2.proposals[1]);
  assert.equal(p2.status, "BLOCKED");

  // Original proposal must NOT be cancelled and must remain active
  const p1Reloaded = await api.getProposal(p1.id);
  assert.notEqual(p1Reloaded.status, "CANCELLED");
  assert.equal(resolveActiveProposal(t2, state(service).proposals).id, p1.id);
});

test("Nit 1: mock reviseProposal dedup preserves substituteFor from swapped line when target line precedes it", async () => {
  const { api } = createMockApi(() => memory());
  const p = await api.createProposal({
    lines: [
      { productId: "salmon", quantity: 1 },
      { productId: "salmon-frozen", quantity: 2 },
    ],
    date: "2026-11-20",
  });
  const revised = await api.reviseProposal(p.id, {
    replacements: [{ fromProductId: "salmon-frozen", toProductId: "salmon" }],
  });
  assert.equal(revised.proposal.lines.length, 1);
  assert.equal(revised.proposal.lines[0].productId, "salmon");
  assert.equal(revised.proposal.lines[0].quantity, 3);
  assert.ok(revised.proposal.lines[0].substituteFor);
  assert.equal(revised.proposal.lines[0].substituteFor.requested, "salmon-frozen");
});
