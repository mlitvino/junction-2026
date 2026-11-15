import type {
  CreateProposalRequest,
  Proposal,
  ReviseProposalRequest,
} from "@/shared/contracts/purchasing";
import { CreateProposalRequestSchema } from "@/shared/contracts/purchasing";
import type { Role } from "@/shared/contracts/me";
import type { CreateRecipeRequest, CreateOrderFromRecipeRequest } from "@/shared/contracts/recipes";
import type { LayerScope, UpdateLayerRequest } from "@/shared/contracts/preferences";
import type { CreateMemberRequest } from "@/shared/contracts/organization";
import { ApiError, type WorkspaceApi } from "./http";
import {
  LocalSchema,
  PlanSchema,
  emptySnapshot,
  emptyLocal,
  getConversationTimeline,
  type WorkspaceSnapshot,
  type RestockPlan,
  type Thread,
  type RestockRun,
} from "./model";
import {
  buildSwapChipText,
  compatibleQuantity,
  convertToSalesUnits,
  findMatchingRecipe,
  isRevisableProposal,
  parseQuantityRevisionCommand,
  parseSwapCommand,
  recipeNeeds,
  resolveActiveProposal,
  type ParsedQuantityRevision,
} from "./helpers";

export {
  buildSwapChipText,
  compatibleQuantity,
  convertToSalesUnits,
  findMatchingRecipe,
  isRevisableProposal,
  parseQuantityRevisionCommand,
  parseSwapCommand,
  recipeNeeds,
  resolveActiveProposal,
};

export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const stamp = () => new Date().toISOString();
// A revision the policy blocks leaves the previous proposal as it was (`previousCancelled: false`).
const keptPrevious = (revised: { previousCancelled?: boolean; proposal: { status: string } }) =>
  revised.previousCancelled === false ||
  (revised.previousCancelled === undefined && revised.proposal.status === "BLOCKED");
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
function parseQtyUnitQuery(text: string) {
  const unitMatch = text.match(
    /\b(\d+(?:[.,]\d+)?)\s*(kg|g|dl|cl|ml|litres?|liters?|l|st|kpl|pcs|cases?)\b/i,
  );
  const quantity = unitMatch ? Number(unitMatch[1]!.replace(",", ".")) : null;
  const rawUnit = unitMatch?.[2]?.toUpperCase() ?? null;
  const unit = rawUnit
    ? /^LIT/.test(rawUnit)
      ? "L"
      : /^CASE/.test(rawUnit)
        ? "KI"
        : rawUnit === "PCS" || rawUnit === "KPL"
          ? "ST"
          : rawUnit
    : null;
  const stripped = text
    .replace(unitMatch?.[0] ?? "", " ")
    .replace(
      /\b(order|buy|purchase|need|want|get|send|deliver(?:ed)?|tomorrow|today|please|of|for|by|some|me|i)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return {
    quantity: quantity && Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unit,
    query: stripped || text.trim(),
  };
}

// Kitchen stock created by "Check low stock and restock to target" when nothing is low yet, so the
// feature can be demonstrated. Each is linked to a real, orderable catalog product at creation.
const DEMO_STOCK = [
  {
    id: "demo-stock-milk",
    name: "Demo: lactose-free milk",
    query: "lactose-free milk",
    unit: "L",
    onHand: 4,
    minimum: 20,
  },
  {
    id: "demo-stock-butter",
    name: "Demo: butter",
    query: "butter",
    unit: "KG",
    onHand: 1,
    minimum: 4,
  },
  {
    id: "demo-stock-cream",
    name: "Demo: cooking cream",
    query: "cooking cream",
    unit: "L",
    onHand: 2,
    minimum: 5,
  },
];

export function createWorkspaceService(
  api: WorkspaceApi,
  options: {
    mock: boolean;
    storage?: () => Storage | null;
    capabilities?: {
      initialPlans?(): RestockPlan[];
      setRoles(roles: Role[]): void;
      setFault(value: "none" | "price" | "expired"): void;
      reset(): void;
    };
  },
) {
  const server = emptySnapshot();
  let snapshot = server,
    started = false,
    epoch = 0;
  const listeners = new Set<() => void>(),
    pending = new Map<string, Promise<unknown>>();
  const key = `aimo:v32:${options.mock ? "development" : "connected"}:presentation`;
  const storage =
    options.storage ?? (() => (typeof window === "undefined" ? null : sessionStorage));
  function publish(patch: Partial<WorkspaceSnapshot>, persist = true) {
    snapshot = { ...snapshot, ...patch };
    if (persist && snapshot.ready) {
      try {
        storage()?.setItem(key, JSON.stringify(snapshot.local));
      } catch {
        snapshot = {
          ...snapshot,
          notice:
            "Local storage is unavailable. Conversation history and locally configured plans will not survive refresh.",
        };
      }
    }
    listeners.forEach((listener) => listener());
  }
  function local(change: (value: WorkspaceSnapshot["local"]) => void) {
    const next = structuredClone(snapshot.local);
    change(next);
    publish({ local: next });
  }
  function record(text: string, resourceId = "", detail = "") {
    local((l) => l.activities.unshift({ id: uid("event"), at: stamp(), text, resourceId, detail }));
  }
  function putProposal(proposal: Proposal) {
    publish({
      proposals: [proposal, ...snapshot.proposals.filter((p) => p.id !== proposal.id)],
      approvals: proposal.approval
        ? [
            { ...proposal.approval, proposal },
            ...snapshot.approvals.filter((a) => a.proposalId !== proposal.id),
          ]
        : snapshot.approvals.filter((a) => a.proposalId !== proposal.id),
    });
  }
  async function single<T>(key: string, action: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const promise = action();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }
  async function initialize() {
    if (started) return;
    started = true;
    publish({ loading: true }, false);
    try {
      const { user } = await api.getMe();
      let stored = emptyLocal(`${user.organization.id}:${user.id}`),
        notice: string | null = null;
      try {
        const raw = storage()?.getItem(key);
        if (raw) {
          const parsed = LocalSchema.parse(JSON.parse(raw));
          if (parsed.owner === stored.owner) stored = parsed;
        } else if (options.mock) stored.plans = options.capabilities?.initialPlans?.() ?? [];
      } catch {
        notice =
          "Local history was unavailable. The purchasing records will be loaded from their source.";
      }
      stored.threads.forEach((thread) => {
        if (thread.working) {
          thread.working = false;
          thread.error =
            "This request was interrupted. Review its current status before continuing; no purchase was completed automatically.";
        }
      });
      publish({ ready: true, loading: false, user, local: stored, notice, error: null });
      await refresh();
    } catch (error) {
      publish({
        ready: true,
        loading: false,
        error: error instanceof Error ? error.message : "Could not load your account.",
      });
    }
  }
  async function refresh() {
    const results = await Promise.allSettled([
      api.listProposals(),
      api.listOrders(),
      snapshot.user?.roles.includes("approver")
        ? api.listApprovals()
        : Promise.resolve({ items: [] }),
    ]);
    const [proposals, orders, approvals] = results;
    publish({
      ...(proposals.status === "fulfilled" ? { proposals: proposals.value.items } : {}),
      ...(orders.status === "fulfilled" ? { orders: orders.value.items } : {}),
      ...(approvals.status === "fulfilled" ? { approvals: approvals.value.items } : {}),
    });
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected")
      publish({
        error:
          failed.reason instanceof Error
            ? failed.reason.message
            : "Could not refresh purchasing records.",
      });
    else publish({ error: null });
  }
  function thread(id: string) {
    const item = snapshot.local.threads.find((t) => t.id === id);
    if (!item) throw new Error("Conversation not found in this browser.");
    return item;
  }
  function editThread(id: string, apply: (t: Thread) => void) {
    local((l) => {
      const t = l.threads.find((t) => t.id === id);
      if (t) {
        t.timeline ??= getConversationTimeline(t, snapshot.proposals);
        apply(t);
      }
    });
  }
  function answer(id: string, text: string) {
    editThread(id, (t) => {
      t.timeline!.push({ kind: "message", index: t.messages.length });
      t.messages.push({ role: "assistant", text, at: stamp() });
    });
  }
  function openProducts(id: string, query: string, replacementId?: string) {
    editThread(id, (t) => {
      for (const entry of t.timeline!) if (entry.kind === "products") entry.closed = true;
      t.query = query;
      t.timeline!.push({ kind: "products", id: uid("selection"), query, replacementId });
    });
  }
  function appendProposalTimeline(id: string, proposalId: string) {
    editThread(id, (t) => {
      if (
        !t.timeline!.some((entry) => entry.kind === "proposal" && entry.proposalId === proposalId)
      ) {
        t.timeline!.push({ kind: "proposal", proposalId });
      }
    });
  }
  function newThread(title: string, source: Thread["source"] = "Assistant") {
    const id = uid("conversation");
    local((l) =>
      l.threads.unshift({
        id,
        title,
        messages: [],
        proposals: [],
        working: false,
        stage: "",
        query: "",
        source,
      }),
    );
    return id;
  }
  async function syncProposalToThread(
    proposal: Proposal,
    threadId: string,
    source: Thread["source"],
    diffText?: string,
  ) {
    putProposal(proposal);
    editThread(threadId, (t) => {
      if (!t.proposals.includes(proposal.id)) t.proposals.push(proposal.id);
      if (diffText !== undefined) t.diff = diffText;
      t.safetyBlocked = false;
    });
    let current = proposal;
    if (proposal.status === "READY" && proposal.decision.outcome === "REQUIRE_APPROVAL") {
      try {
        current = await api.requestApproval(proposal.id);
        putProposal(current);
        record("Purchase sent for human review", proposal.id, current.approval?.id);
      } catch (error) {
        editThread(threadId, (t) => {
          t.error = `The purchase proposal was prepared, but sending it for review failed. Use Send for review to retry without creating another proposal. ${error instanceof Error ? error.message : ""}`;
        });
      }
    } else if (source !== "Assistant") {
      record(
        "Purchase proposal synced",
        current.id,
        `Source: ${source}. Status: ${current.status}.`,
      );
    }
    return current;
  }
  async function createPurchase(
    body: CreateProposalRequest,
    threadId?: string,
    source: Thread["source"] = "Assistant",
    replaceId?: string,
    pickerId?: string,
  ) {
    return single(`create:${threadId ?? JSON.stringify(body)}`, async () => {
      if (threadId && pickerId) {
        editThread(threadId, () => {});
        const picker = thread(threadId).timeline?.find(
          (entry) => entry.kind === "products" && entry.id === pickerId,
        );
        if (!picker || picker.kind !== "products" || picker.closed || picker.proposalId)
          throw new Error(
            "This product selection is closed. Send a new message to change the purchase.",
          );
      }
      body = CreateProposalRequestSchema.parse(body);
      if (!snapshot.user?.roles.includes("buyer"))
        throw new Error("A Buyer is required to prepare this purchase.");
      if (threadId && thread(threadId).requirement)
        throw new Error(
          "The mandatory dietary requirement still needs verified evidence. This conversation cannot prepare an unverified purchase.",
        );
      const effective = await api.getEffective();
      if (!effective.buyer)
        throw new Error(
          "Buyer purchasing preferences could not be verified. Please refresh your account.",
        );
      for (const line of body.lines) {
        const product =
          snapshot.productDetails[line.productId] ?? (await loadProduct(line.productId));
        if (
          ["KI", "ST", "PAK"].includes(product.salesUnit.toUpperCase()) &&
          !Number.isInteger(line.quantity)
        )
          throw new Error(
            `${product.name} requires whole sales units. Review the package quantity before continuing.`,
          );
      }
      const id =
        threadId ??
        newThread(source === "Assistant" ? "Purchase request" : `${source} purchase`, source);
      let oldToCancel: Proposal | undefined;
      if (replaceId) {
        const old = await api.getProposal(replaceId);
        if (old.status === "ORDERED")
          throw new Error("A recorded order cannot be edited. Start a separate purchase request.");
        if (["READY", "PENDING_APPROVAL", "APPROVED"].includes(old.status)) {
          oldToCancel = old;
        }
      }
      const created = await api.createProposal(body);
      putProposal(created);
      editThread(id, (t) => {
        if (!t.proposals.includes(created.id)) t.proposals.push(created.id);
        if (pickerId) {
          const picker = t.timeline!.find(
            (entry) => entry.kind === "products" && entry.id === pickerId,
          );
          if (picker?.kind === "products") {
            picker.proposalId = created.id;
            picker.closed = true;
          }
        }
        t.diff = replaceId
          ? created.status === "BLOCKED"
            ? "Change blocked by policy; previous proposal remains active."
            : "A new purchase proposal replaces the previous quantity, products or delivery requirements."
          : undefined;
        t.safetyBlocked = false;
      });
      record(
        "Purchase proposal prepared",
        created.id,
        `Source: ${source}. Prices excluding VAT. ${created.hash}`,
      );
      if (oldToCancel && created.status !== "BLOCKED") {
        const cancelled = await api.cancelProposal(oldToCancel.id);
        putProposal(cancelled);
        record(
          "Previous proposal withdrawn after a change",
          oldToCancel.id,
          `Replaced revision in ${id}`,
        );
      }
      const current = await syncProposalToThread(
        created,
        id,
        source,
        replaceId
          ? created.status === "BLOCKED"
            ? "Change blocked by policy; previous proposal remains active."
            : "A new purchase proposal replaces the previous quantity, products or delivery requirements."
          : undefined,
      );
      if (source !== "Recipes" && !replaceId) {
        editThread(id, (t) => {
          t.recipeReconciliation = undefined;
        });
      }
      answer(
        id,
        current.status === "BLOCKED"
          ? "This purchase does not meet the purchasing requirements. You can change the request or review the reasons below."
          : "I’ve prepared a purchase proposal. Please review the products, quantity and conditions before continuing.",
      );
      appendProposalTimeline(id, created.id);
      return { threadId: id, proposal: current };
    });
  }
  async function createPurchaseFromRecipe(body: CreateOrderFromRecipeRequest, threadId?: string) {
    return single(`recipe:${threadId ?? body.recipeId ?? body.dishQuery ?? "custom"}`, async () => {
      if (!snapshot.user?.roles.includes("buyer"))
        throw new Error("A Buyer is required to prepare this purchase.");
      const result = await api.createProposalFromRecipe(body);
      const id =
        threadId ??
        newThread(`${result.recipeUsed.name} · ${result.requestedServings} portions`, "Recipes");
      let current: Proposal | null = null;
      if (result.proposal) {
        record(
          "Recipe purchase proposal prepared",
          result.proposal.id,
          `${result.recipeUsed.name}, ${result.requestedServings} portions.`,
        );
        current = await syncProposalToThread(result.proposal, id, "Recipes");
      }
      editThread(id, (t) => {
        t.recipeChoice = false;
        t.recipeReconciliation = {
          recipeId: result.recipeUsed.id,
          recipeName: result.recipeUsed.name,
          requestedServings: result.requestedServings,
          scaleFactor: result.scaleFactor,
          items: result.ingredientReconciliation,
        };
      });
      const covered = result.ingredientReconciliation.filter((r) => r.coveredByInventory).length;
      const ordered = result.ingredientReconciliation.filter((r) => !r.coveredByInventory).length;
      answer(
        id,
        `${result.message} Inventory check: ${covered} covered by kitchen stock, ${ordered} need ordering.`,
      );
      if (current) appendProposalTimeline(id, current.id);
      return { threadId: id, response: { ...result, proposal: current } };
    });
  }
  async function searchProducts(
    q: string,
    offset = 0,
    filters?: Parameters<WorkspaceApi["searchProducts"]>[2],
  ) {
    const result = await api.searchProducts(q, offset, filters);
    publish({ products: result.items });
    return result;
  }
  async function loadProduct(id: string) {
    const product = await api.getProduct(id);
    publish({ productDetails: { ...snapshot.productDetails, [id]: product } });
    return product;
  }
  async function toSales(productId: string, quantity: number, unit: string) {
    const product = snapshot.productDetails[productId] ?? (await loadProduct(productId));
    return convertToSalesUnits(product, quantity, unit)?.quantity ?? null;
  }
  async function seedDemoStock() {
    const created: string[] = [];
    for (const demo of DEMO_STOCK) {
      // Keep stock the user has already adjusted, including a completed demo restock.
      if (
        snapshot.inventory.some((item) => item.id === demo.id || item.id.startsWith(`${demo.id}-`))
      )
        continue;
      const candidates = (await api.searchProducts(demo.query, 0)).items.slice(0, 8);
      if (!candidates.length) continue;
      const { offers } = await api.getOffers(
        candidates.map((p) => p.id),
        today(),
      );
      const needed = Math.max(demo.minimum, demo.onHand) * 2 - demo.onHand;
      let productId: string | undefined;
      for (const product of candidates) {
        const offer = offers.find((o) => o.productId === product.id);
        const available = offer?.availability;
        if (
          !offer?.price?.found ||
          offer.price.priceExclVat === null ||
          !available?.orderable ||
          available.salesBlock
        )
          continue;
        const sales = await toSales(product.id, needed, demo.unit);
        if (
          sales !== null &&
          available.availableQuantity !== null &&
          available.availableQuantity >= sales &&
          (available.availableDate?.slice(0, 10) ?? "9999") <= today()
        ) {
          productId = product.id;
          break;
        }
      }
      if (!productId) continue;
      await api.saveInventory({
        id: uid(demo.id),
        ingredientName: demo.name,
        productType: demo.name,
        linkedProductId: productId,
        quantityInStock: demo.onHand,
        unit: demo.unit,
        minParLevel: demo.minimum,
        location: "Demo kitchen",
      });
      record(
        "Demo kitchen stock created",
        productId,
        `${demo.name}: ${demo.onHand} ${demo.unit} on hand, trigger ${demo.minimum} ${demo.unit}.`,
      );
      created.push(demo.name);
    }
    return created;
  }
  async function handleRestockSetup(id: string, text: string, current?: Proposal) {
    await loadInventory();
    const requested = text
      .match(/(?:restock|replenish)\s+(.+?)(?:\s+to\s|\s+instead|$)/i)?.[1]
      ?.toLowerCase();
    const item = requested
      ? snapshot.inventory.find((i) => i.ingredientName.toLowerCase().includes(requested))
      : undefined;
    if (item) {
      if (current && ["READY", "PENDING_APPROVAL", "APPROVED"].includes(current.status)) {
        putProposal(await api.cancelProposal(current.id));
        record("Previous purchase withdrawn for restocking changes", current.id);
      }
      const previous = snapshot.local.plans.find((p) => p.inventoryId === item.id);
      const target =
        Number(text.match(/\bto\s+(\d+(?:\.\d+)?)/i)?.[1]) ||
        previous?.target ||
        Math.max(item.minParLevel ?? 1, item.quantityInStock) * 2;
      const draft: RestockPlan = {
        id: previous?.id ?? uid("plan"),
        name: previous?.name ?? item.ingredientName,
        ingredient: item.ingredientName,
        productId: item.linkedProductId ?? "",
        unit: item.unit,
        current: item.quantityInStock,
        threshold: item.minParLevel ?? previous?.threshold ?? 1,
        target,
        location: item.location ?? "Kitchen",
        schedule: previous?.schedule ?? "threshold",
        paused: false,
        inventoryId: item.id,
      };
      local((l) => {
        l.drafts["restock:new"] = JSON.stringify(draft);
      });
    }
    if (!item && /\blow\s+stock\b|\bto\s+target\b|\bbelow\b/i.test(text)) {
      const findLow = () =>
        snapshot.inventory.flatMap((i) =>
          i.linkedProductId && i.minParLevel !== null && i.quantityInStock < i.minParLevel
            ? [{ stock: i, productId: i.linkedProductId, minPar: i.minParLevel }]
            : [],
        );
      let low = findLow();
      let demo: string[] = [];
      if (!low.length) {
        demo = await single("seed-demo-stock", seedDemoStock);
        if (demo.length || snapshot.inventory.some((item) => item.id.startsWith("demo-stock-"))) {
          await loadInventory();
          low = findLow();
        }
      }
      const unlinked = snapshot.inventory.filter(
        (i) => !i.linkedProductId && i.minParLevel !== null && i.quantityInStock < i.minParLevel,
      );
      const unlinkedNames = `${unlinked.map((i) => i.ingredientName).join(", ")} ${unlinked.length === 1 ? "is" : "are"}`;
      if (low.length) {
        const lines: RestockRun["lines"] = [];
        for (const { stock, productId, minPar } of low) {
          const previous = snapshot.local.plans.find((p) => p.inventoryId === stock.id);
          const plan = PlanSchema.parse({
            id: previous?.id ?? uid("plan"),
            name: previous?.name ?? stock.ingredientName,
            ingredient: stock.ingredientName,
            productId,
            unit: stock.unit,
            current: stock.quantityInStock,
            threshold: minPar,
            target: previous?.target ?? Math.max(minPar, stock.quantityInStock) * 2,
            location: stock.location ?? "Kitchen",
            schedule: previous?.schedule ?? "threshold",
            paused: previous?.paused ?? false,
            inventoryId: stock.id,
          } satisfies RestockPlan);
          local((l) => {
            l.plans = [plan, ...l.plans.filter((p) => p.id !== plan.id)];
          });
          record(
            "Restocking plan configured locally",
            plan.id,
            "Created from a low-stock check. Background scheduling is not connected; run checks manually.",
          );
          lines.push(...(await evaluatePlan(plan.id)).lines);
        }
        excludeOverlappingLines(lines);
        const run: RestockRun = {
          id: uid("check"),
          planId: "all",
          at: stamp(),
          lines,
          conversationId: id,
        };
        local((l) => l.runs.unshift(run));
        record(
          "Restocking check completed",
          run.id,
          "Created from a low-stock request. No server scheduler or inventory reservation is active.",
        );
        const ready = lines.filter((l) => l.state === "ready").length;
        answer(
          id,
          `${demo.length ? `No linked stock was low, so I added demo kitchen stock linked to real catalog products (${demo.join(", ")}). ` : ""}${low.length} item${low.length === 1 ? " is" : "s are"} below the trigger level, so I configured restock plans and checked prices and availability for today. ${ready} ${ready === 1 ? "is" : "are"} ready for a purchase proposal${ready < lines.length ? "; the rest need attention" : ""}. Nothing has been ordered.${unlinked.length ? ` Skipped because they aren’t linked to a Valio product: ${unlinked.map((i) => i.ingredientName).join(", ")}.` : ""} Review the plan below, then prepare the purchase proposal for review.`,
        );
        editThread(id, (t) => {
          t.query = "restocking";
          t.timeline!.push({ kind: "restock", runId: run.id });
        });
        return;
      }
      const reason = !snapshot.inventory.length
        ? "No kitchen stock is recorded yet, so there is nothing to compare against trigger levels."
        : unlinked.length
          ? `${unlinkedNames} below the minimum stock level but not linked to a Valio product, so I can’t check prices or availability for a restock. Create a plan for ${unlinked.length === 1 ? "it" : "them"} from Restocking → New plan and choose the product.`
          : `Nothing is below its minimum stock level (${snapshot.inventory.length} ${snapshot.inventory.length === 1 ? "item" : "items"} checked), so no restock plan is needed.`;
      // Demo stock is always attempted first, so say when the catalog had nothing suitable.
      answer(
        id,
        demo.length
          ? reason
          : `${reason} Demo setup needs new matching catalog products with a confirmed price, compatible units and enough stock for delivery today. Existing kitchen stock was kept.`,
      );
      return;
    }
    answer(
      id,
      "Let’s set the product, trigger level and target stock. Restocking plans are configured locally until background scheduling is connected.",
    );
    editThread(id, (t) => {
      t.query = "restocking";
    });
  }
  async function executeSwap(
    id: string,
    current: Proposal,
    swap: { fromProductId: string; toProductId: string },
  ) {
    editThread(id, (t) => {
      t.stage = "Updating purchase proposal";
    });
    const revised = await api.reviseProposal(current.id, { replacements: [swap] });
    const updated = await syncProposalToThread(
      revised.proposal,
      id,
      thread(id).source,
      keptPrevious(revised)
        ? "Change blocked by policy; previous proposal remains active."
        : revised.appliedChanges.join(" ") || "Swapped to an alternative product.",
    );
    await refresh();
    answer(
      id,
      keptPrevious(revised)
        ? "The revised proposal does not meet purchasing requirements. Your previous proposal remains active. Review the policy reasons below."
        : `Updated the proposal (${revised.appliedChanges.join(", ") || "swapped product"}). Please review before continuing.`,
    );
    appendProposalTimeline(id, updated.id);
  }
  async function executeQuantityRevision(
    id: string,
    current: Proposal,
    parsed: Extract<ParsedQuantityRevision, { recognized: true }>,
    note: string,
  ) {
    const sales = await toSales(parsed.productId, parsed.quantity, parsed.unit);
    if (sales === null) {
      answer(
        id,
        `I need a verified conversion from ${parsed.unit} to ${parsed.salesUnit ?? "sales units"}. Confirm the quantity below; the current proposal has not changed.`,
      );
      openProducts(id, parsed.lineName, isRevisableProposal(current) ? current.id : undefined);
      return;
    }
    const prevProposal: Proposal = current;
    if (isRevisableProposal(current)) {
      editThread(id, (t) => {
        t.stage = "Updating purchase proposal";
      });
      const revised = await api.reviseProposal(current.id, {
        quantityUpdates: [{ productId: parsed.productId, quantity: sales }],
      });
      const updated = await syncProposalToThread(
        revised.proposal,
        id,
        thread(id).source,
        keptPrevious(revised)
          ? "Change blocked by policy; previous proposal remains active."
          : revised.appliedChanges.join(" ") ||
              "A new purchase proposal replaces the previous quantity.",
      );
      await refresh();
      answer(
        id,
        keptPrevious(revised)
          ? "The revised proposal does not meet purchasing requirements. Your previous proposal remains active. Review the policy reasons below."
          : `Updated the proposal (${revised.appliedChanges.join(", ") || `${sales} ${parsed.salesUnit ?? "units"}`}). Please review before continuing.`,
      );
      appendProposalTimeline(id, updated.id);
      return;
    }
    await createPurchase(
      {
        lines: prevProposal.lines.map((l) => ({
          productId: l.productId,
          quantity: l.productId === parsed.productId ? sales : l.quantity,
        })),
        date: prevProposal.pricingDate,
        note,
      },
      id,
      thread(id).source,
      prevProposal.id,
    );
  }
  async function handleConnectedMessage(id: string, text: string, current?: Proposal) {
    if (!snapshot.user?.roles.includes("buyer")) {
      answer(
        id,
        "A Buyer role is required to create or revise purchases. You can review pending approvals or ask why the current proposal was chosen.",
      );
      return;
    }
    if (
      /(?:^|\b)(?:restock|replenish|reorder)\b/i.test(text) &&
      !/\b(?:order|buy|purchase)\b/i.test(text)
    ) {
      await handleRestockSetup(id, text, current);
      return;
    }
    const qtyCheck = parseQuantityRevisionCommand(text, current);
    if (isRevisableProposal(current) && qtyCheck.recognized) {
      await executeQuantityRevision(id, current, qtyCheck, text);
      return;
    }
    editThread(id, (t) => {
      t.stage = "Finding suitable products & checking policy";
    });
    try {
      const result = await api.runAgent({
        message: text,
        ...(isRevisableProposal(current) ? { proposalId: current.id } : {}),
      });
      if (result.activeProposal) {
        const replaced = !!current && result.activeProposal.id !== current.id;
        const synced = await syncProposalToThread(
          result.activeProposal,
          id,
          thread(id).source,
          replaced ? "Updated purchase proposal based on your latest request." : undefined,
        );
        if (replaced) await refresh();
        let nextReconciliation = thread(id).recipeReconciliation;
        if (synced.source === "recipe") {
          const [recipes, inventory] = await Promise.all([loadRecipes(), loadInventory()]);
          const recipeCall = result.toolCalls.find((tc) => /recipe/i.test(tc.toolName));
          const recipeIdArg =
            typeof recipeCall?.args.recipeId === "string" ? recipeCall.args.recipeId : undefined;
          const dishArg =
            typeof recipeCall?.args.dishQuery === "string" ? recipeCall.args.dishQuery : undefined;
          const hint =
            `${recipeIdArg ?? ""} ${dishArg ?? ""} ${synced.note ?? ""} ${synced.selection?.prompt ?? ""} ${text}`.toLowerCase();
          const matchedRecipe =
            (recipeIdArg ? recipes.find((r) => r.id === recipeIdArg) : undefined) ??
            recipes.find(
              (r) =>
                hint.includes(r.name.toLowerCase().split(" (")[0]!.toLowerCase()) ||
                r.tags.some((tag) => hint.includes(tag.replace("-", " "))),
            );
          if (matchedRecipe) {
            const argServings =
              typeof recipeCall?.args.servings === "number" ? recipeCall.args.servings : undefined;
            const textServings = Number(
              `${synced.note ?? ""} ${synced.selection?.prompt ?? ""} ${text}`.match(
                /(\d+(?:\.\d+)?)\s*(?:portions|servings)/i,
              )?.[1],
            );
            const servings =
              argServings && argServings > 0
                ? argServings
                : textServings > 0
                  ? textServings
                  : matchedRecipe.baseServings;
            const rows = recipeNeeds(matchedRecipe, servings, inventory);
            nextReconciliation = {
              recipeId: matchedRecipe.id,
              recipeName: matchedRecipe.name,
              requestedServings: servings,
              scaleFactor: servings / matchedRecipe.baseServings,
              items: rows.map((row) => ({
                productName: row.ingredient.productName,
                productType: row.ingredient.productType,
                normalizedUnit: row.ingredient.unit.toUpperCase(),
                aggregatedBaseQuantity: row.ingredient.quantity,
                totalNeededQuantity: row.needed,
                inventoryStockQuantity: row.stock,
                actuallyNeededQuantity: row.shortage,
                coveredByInventory: row.shortage === 0,
                matchedInventoryItemIds: row.inventory.map((inv) => inv.id),
              })),
            };
          }
        } else if (
          !replaced ||
          current?.source !== "recipe" ||
          !/\b(change|swap|replace|make it|set)\b/i.test(text)
        ) {
          nextReconciliation = undefined;
        }
        editThread(id, (t) => {
          t.query = "";
          t.recipeChoice = false;
          t.recipeReconciliation = nextReconciliation;
        });
        const warnings = synced.selection?.warnings ?? [];
        answer(
          id,
          warnings.length ? `${result.reply}\n\nNote: ${warnings.join(" ")}` : result.reply,
        );
        appendProposalTimeline(id, synced.id);
        return;
      }
      answer(id, result.reply);
      if (/recipe|portions|servings/i.test(text)) {
        await loadRecipes();
        editThread(id, (t) => {
          t.recipeChoice = true;
        });
        return;
      }
      const parsed = parseQtyUnitQuery(text);
      await searchProducts(parsed.query);
      openProducts(id, parsed.query, isRevisableProposal(current) ? current.id : undefined);
    } catch (error) {
      const agentUnavailable =
        error instanceof ApiError &&
        (error.status === 503 ||
          error.code === "AGENT_NOT_CONFIGURED" ||
          error.code === "MODEL_FAILED");
      if (!agentUnavailable) throw error;
      const swapCheck = parseSwapCommand(text, current);
      if (swapCheck.recognized) {
        if (swapCheck.swap && isRevisableProposal(current)) {
          await executeSwap(id, current, swapCheck.swap);
        } else {
          answer(
            id,
            swapCheck.swap === null
              ? swapCheck.error
              : "There is no active revisable proposal to swap products on.",
          );
        }
        return;
      }
      const fallbackQty = parseQuantityRevisionCommand(text, current);
      if (isRevisableProposal(current) && fallbackQty.recognized) {
        await executeQuantityRevision(id, current, fallbackQty, text);
        return;
      }
      if (/recipe|macaroni|salmon|soup|meal|portions|servings/i.test(text)) {
        const recipes = await loadRecipes();
        const servings = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:portions|servings)/i)?.[1]);
        const matched = findMatchingRecipe(text, recipes);
        if (matched) {
          await createPurchaseFromRecipe(
            {
              recipeId: matched.id,
              ...(servings > 0 ? { servings } : {}),
              autoResolvePartialStock: true,
            },
            id,
          );
          return;
        }
        editThread(id, (t) => {
          t.recipeChoice = true;
        });
        answer(
          id,
          "Which recipe should I prepare? Choose one below to plan portions against your kitchen inventory.",
        );
        return;
      }
      const parsed = parseQtyUnitQuery(text);
      let query = parsed.query;
      try {
        const extracted = await api.extract(text);
        if (extracted.items[0]?.productName) query = extracted.items[0].productName;
      } catch {
        /* /api/extract also requires model key when unconfigured; keep parsed query */
      }
      await searchProducts(query);
      try {
        const ranked = await api.rankProducts({
          q: query,
          quantity: parsed.quantity ?? 1,
          ...(parsed.unit ? { unit: parsed.unit } : {}),
        });
        const top = ranked.ranked
          .slice(0, 3)
          .map(
            (r) =>
              `${r.tier ? `${r.tier.toUpperCase()}: ` : ""}${r.product.name} (${r.quantity} ${r.salesUnit}, ${r.lineTotalExclVat.toFixed(2)} EUR excl. VAT)`,
          )
          .join("; ");
        answer(
          id,
          top
            ? `AI agent key is not configured, so here are the top compliant catalog matches: ${top}. Confirm your choice in the product picker below.`
            : "No fully available match passed all purchasing rules. Review the catalog search results below.",
        );
      } catch {
        answer(
          id,
          "AI agent model is unavailable right now. Search and select products directly in the product picker below.",
        );
      }
      openProducts(id, query, isRevisableProposal(current) ? current.id : undefined);
    }
  }
  async function sendMessage(id: string, message: string) {
    return single(`message:${id}`, async () => {
      const text = message.trim();
      if (!text) return;
      const runEpoch = epoch;
      editThread(id, (t) => {
        for (const entry of t.timeline!) if (entry.kind === "products") entry.closed = true;
        t.timeline!.push({ kind: "message", index: t.messages.length });
        t.messages.push({ role: "user", text, at: stamp() });
        t.working = true;
        t.error = undefined;
        t.stage = "Understanding your request";
      });
      try {
        const current = resolveActiveProposal(thread(id), snapshot.proposals);
        const mandatory = /milk.protein.free|gluten.free|no.*allergen/i.test(text);
        if (!mandatory && /^(why|what|explain|compare|show.*alternative)/i.test(text)) {
          if (current && /alternative|compare/i.test(text))
            editThread(id, (t) => {
              t.query = current.lines[0]?.name.split(" ")[0] ?? "";
            });
          const warnings = current?.selection?.warnings.length
            ? ` Notes: ${current.selection.warnings.join(" ")}`
            : "";
          answer(
            id,
            current
              ? `The recommendation uses ${current.lines.map((l) => l.name).join(", ")}, priced for ${current.pricingDate}. ${current.decision.reasons.map((r) => r.message).join(" ")}${warnings} Availability and units are shown in the item details. This explanation does not change your proposal.`
              : "Choose a product or prepare a purchase first, and I can explain its pricing, units and purchasing conditions.",
          );
          if (current && /alternative|compare/i.test(text))
            openProducts(
              id,
              thread(id).query,
              current.status === "ORDERED" ? undefined : current.id,
            );
          return;
        }
        if (!mandatory) {
          const swapCheck = parseSwapCommand(text, current);
          if (swapCheck.recognized) {
            if (swapCheck.swap && isRevisableProposal(current)) {
              await executeSwap(id, current, swapCheck.swap);
              return;
            }
            if (options.mock) {
              answer(
                id,
                swapCheck.swap === null
                  ? swapCheck.error
                  : "There is no active revisable proposal to swap products on.",
              );
              return;
            }
          }
        }
        if (!options.mock) {
          await handleConnectedMessage(id, text, current);
          return;
        }
        const hasRecipeKeyword = /\b(?:recipe|macaroni|salmon|soup|meal|portions|servings)\b/i.test(
          text,
        );
        const loadedRecipes =
          snapshot.recipes.length > 0
            ? snapshot.recipes
            : hasRecipeKeyword
              ? await loadRecipes()
              : [];
        const matchedRecipe = findMatchingRecipe(text, loadedRecipes);
        if (hasRecipeKeyword || matchedRecipe) {
          if (isRevisableProposal(current)) {
            putProposal(await api.cancelProposal(current.id));
            record("Previous purchase withdrawn for recipe planning", current.id);
          }
          if (!mandatory && !thread(id).requirement && matchedRecipe) {
            const servings = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:portions|servings)/i)?.[1]);
            await createPurchaseFromRecipe(
              {
                recipeId: matchedRecipe.id,
                ...(servings > 0 ? { servings } : {}),
                autoResolvePartialStock: true,
              },
              id,
            );
            return;
          }
          await loadRecipes();
          editThread(id, (t) => {
            t.recipeChoice = true;
            t.safetyBlocked = false;
            if (/gluten.free/i.test(text)) t.requirement = "gluten-free";
            if (/milk.protein.free/i.test(text)) t.requirement = "milk-protein-free";
          });
          answer(
            id,
            "Which recipe should I use? Choose a recipe below, then adjust the portion count in the batch plan.",
          );
          return;
        }
        if (/restock|replenish|reorder/i.test(text) && !mandatory && !thread(id).requirement) {
          await handleRestockSetup(id, text, current);
          return;
        }
        if (mandatory || thread(id).requirement) {
          if (current && ["READY", "PENDING_APPROVAL", "APPROVED"].includes(current.status)) {
            const cancelled = await api.cancelProposal(current.id);
            putProposal(cancelled);
            record("Previous purchase withdrawn for a mandatory requirement change", current.id);
          }
          editThread(id, (t) => {
            t.safetyBlocked = true;
            if (/gluten.free/i.test(text)) t.requirement = "gluten-free";
            if (/milk.protein.free/i.test(text)) t.requirement = "milk-protein-free";
          });
          answer(
            id,
            "I cannot verify this mandatory dietary requirement from the available evidence. No purchase will be prepared from an unverified ingredient. Choose a verified product or clarify the requirement.",
          );
          return;
        }
        const qtyCheck = parseQuantityRevisionCommand(text, current);
        if (current && current.status !== "ORDERED" && qtyCheck.recognized) {
          await executeQuantityRevision(id, current, qtyCheck, text);
          return;
        }
        const quantity = Number(
          text
            .match(/(?:make|change|set|order|need|buy|to)\s+(?:it\s+)?([\d,.]+)/i)?.[1]
            ?.replace(/,/g, ""),
        );
        if (
          current &&
          /prefer|substitut|budget|delivery|needed.by|by monday|by friday/i.test(text)
        ) {
          if (["READY", "PENDING_APPROVAL", "APPROVED"].includes(current.status)) {
            putProposal(await api.cancelProposal(current.id));
            record("Previous purchase withdrawn for revised requirements", current.id);
          }
          editThread(id, (t) => {
            t.query = current.lines[0]?.name ?? "";
          });
          answer(
            id,
            "Please confirm the updated product, sales-unit quantity and delivery date below. The previous pending purchase has been withdrawn so it cannot be approved with outdated requirements.",
          );
          openProducts(id, thread(id).query, current.id);
          return;
        }
        editThread(id, (t) => {
          t.stage = "Finding suitable products";
        });
        const query = /cheese/i.test(text)
          ? "cheese"
          : /cream/i.test(text)
            ? "cream"
            : /oat/i.test(text)
              ? "oat"
              : /milk/i.test(text)
                ? "milk"
                : text;
        const found = await searchProducts(query);
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (epoch !== runEpoch) return;
        if (found.items.length >= 1 && quantity > 0) {
          const p = found.items[0]!;
          const requestedUnit = /\bkg\b/i.test(text)
            ? "KG"
            : /litre|liter|\bL\b/i.test(text)
              ? "L"
              : p.salesUnit;
          const sales = await toSales(p.id, quantity, requestedUnit);
          if (sales !== null) {
            editThread(id, (t) => {
              t.stage = "Checking purchasing conditions";
              t.recipeReconciliation = undefined;
            });
            await createPurchase(
              { lines: [{ productId: p.id, quantity: sales }], date: "2026-11-20", note: text },
              id,
              thread(id).source,
              isRevisableProposal(current) ? current.id : undefined,
            );
            return;
          }
          answer(
            id,
            "Choose the product and confirm its sales-unit quantity below. I’ll prepare it for review.",
          );
          openProducts(id, query, current?.status === "ORDERED" ? undefined : current?.id);
        } else {
          const extracted = await api.extract(text);
          const query = extracted.items[0]?.productName ?? text;
          await searchProducts(query);
          answer(
            id,
            "I found the purchasing requirements. Confirm the product, sales-unit quantity and delivery date below. Physical quantities need verified packaging information before they can be ordered.",
          );
          openProducts(id, query, current?.status === "ORDERED" ? undefined : current?.id);
        }
      } catch (error) {
        editThread(id, (t) => {
          t.error = error instanceof Error ? error.message : "Could not process this request.";
        });
        throw error;
      } finally {
        if (epoch === runEpoch)
          editThread(id, (t) => {
            t.working = false;
          });
      }
    });
  }
  async function approve(proposalId: string, decision: "APPROVED" | "REJECTED", comment = "") {
    return single(`decision:${proposalId}`, async () => {
      const shown = snapshot.proposals.find((p) => p.id === proposalId);
      if (!shown?.approval) throw new Error("This purchase has no review request.");
      try {
        const updated = await api.decideApproval(shown.approval.id, {
          decision,
          proposalHash: shown.hash,
          ...(comment ? { comment } : {}),
        });
        putProposal(updated);
        record(
          decision === "APPROVED" ? "Purchase approved" : "Purchase rejected",
          shown.id,
          comment,
        );
        return updated;
      } catch (error) {
        await refresh();
        const message =
          error instanceof Error
            ? error.message
            : "The review decision could not be confirmed. Refresh before trying again.";
        publish({ error: message });
        for (const t of snapshot.local.threads.filter((t) => t.proposals.includes(proposalId)))
          editThread(t.id, (thread) => {
            thread.error = message;
          });
        throw error;
      }
    });
  }
  async function placeOrder(proposalId: string) {
    return single(`order:${proposalId}`, async () => {
      let attempt = snapshot.local.orderKeys[proposalId];
      if (!attempt) {
        attempt = uid("purchase");
        local((l) => {
          l.orderKeys[proposalId] = attempt!;
        });
      }
      try {
        const order = await api.placeOrder(proposalId, attempt);
        publish({ orders: [order, ...snapshot.orders.filter((o) => o.id !== order.id)] });
        putProposal(await api.getProposal(proposalId));
        record(
          "Order recorded",
          order.id,
          "The supplier ordering and payment integrations are not connected.",
        );
        return order;
      } catch (error) {
        if (
          error instanceof ApiError &&
          ["QUOTE_EXPIRED", "PRICE_CHANGED", "AVAILABILITY_CHANGED", "HASH_MISMATCH"].includes(
            error.code,
          )
        )
          local((l) => {
            if (!l.stale.includes(proposalId)) l.stale.push(proposalId);
          });
        await refresh();
        const message =
          error instanceof Error
            ? error.message
            : "The order could not be confirmed. Refresh its status before retrying.";
        publish({ error: message });
        for (const t of snapshot.local.threads.filter((t) => t.proposals.includes(proposalId)))
          editThread(t.id, (thread) => {
            thread.error = message;
          });
        throw error;
      }
    });
  }
  async function loadRecipes(q = "") {
    const result = await api.listRecipes(q);
    publish({ recipes: result.recipes });
    return result.recipes;
  }
  async function loadRecipe(id: string) {
    const recipe = await api.getRecipe(id);
    publish({ recipes: [recipe, ...snapshot.recipes.filter((r) => r.id !== id)] });
    return recipe;
  }
  async function loadInventory() {
    const result = await api.getInventory();
    publish({ inventory: result.items });
    return result.items;
  }
  async function loadSettings() {
    const effective = await api.getEffective();
    publish({ effective });
    if (snapshot.user?.roles.includes("approver")) {
      const layers = await api.getLayers();
      publish({ layers });
    }
  }
  async function loadMembers() {
    const { members } = await api.getMembers();
    publish({ members });
  }
  async function evaluatePlan(planId: string) {
    const plan = snapshot.local.plans.find((p) => p.id === planId);
    if (!plan) throw new Error("Restocking plan not found.");
    const stock = await loadInventory();
    const match = plan.inventoryId
      ? stock.find((i) => i.id === plan.inventoryId)
      : stock.find((i) => i.linkedProductId === plan.productId);
    const current = match
      ? compatibleQuantity(match.quantityInStock, match.unit, plan.unit)
      : plan.current;
    const amount =
      current === null ? null : current >= plan.threshold ? 0 : Math.max(0, plan.target - current);
    const offers = await api.getOffers([plan.productId], today());
    const latest = await api.listProposals();
    publish({ proposals: latest.items });
    const offer = offers.offers[0];
    const sales = amount === null ? null : await toSales(plan.productId, amount, plan.unit);
    const availability = offer?.availability;
    const existing = snapshot.proposals.some(
      (p) =>
        ["READY", "PENDING_APPROVAL", "APPROVED"].includes(p.status) &&
        p.lines.some((l) => l.productId === plan.productId),
    );
    const state =
      plan.paused || existing
        ? "partial"
        : amount === 0
          ? "covered"
          : !offer?.price?.found ||
              offer.price.priceExclVat === null ||
              !availability?.orderable ||
              availability.salesBlock ||
              availability.availableQuantity === null ||
              sales === null
            ? "unknown"
            : availability.availableQuantity < sales ||
                (availability.availableDate?.slice(0, 10) ?? "9999") > today()
              ? "partial"
              : "ready";
    const run: RestockRun = {
      id: uid("check"),
      planId,
      at: stamp(),
      lines: [
        {
          productId: plan.productId,
          name: plan.ingredient,
          quantity: sales ?? amount ?? 0,
          unit: sales !== null ? (offer?.price?.salesUnit ?? plan.unit) : plan.unit,
          state,
          reason: plan.paused
            ? "This plan is paused. Resume it before preparing a purchase."
            : existing
              ? "An open purchase already includes this product. Review it to avoid duplicate coverage; inventory has not been reserved."
              : state === "ready"
                ? "A purchase can be prepared for review."
                : state === "covered"
                  ? "Stock is above the configured trigger. No purchase is needed."
                  : "Excluded from purchase until quantity, date or availability is confirmed.",
          ...(current === null
            ? {}
            : {
                onHand: current,
                trigger: plan.threshold,
                target: plan.target,
                stockUnit: plan.unit,
              }),
        },
      ],
    };
    return run;
  }
  async function checkPlan(planId: string) {
    const run = await evaluatePlan(planId);
    local((l) => l.runs.unshift(run));
    record(
      "Restocking check completed",
      run.id,
      "Manual check. No server scheduler or inventory reservation is active.",
    );
    return run;
  }
  function excludeOverlappingLines(lines: RestockRun["lines"]) {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line.productId, (counts.get(line.productId) ?? 0) + 1);
    for (const line of lines)
      if ((counts.get(line.productId) ?? 0) > 1 && line.state !== "covered") {
        line.state = "partial";
        line.reason =
          "Several plans reference this product. Consolidate their stock targets before purchasing to avoid duplicate coverage.";
      }
  }
  return {
    api,
    mock: options.mock,
    initialize,
    subscribe(listener: () => void) {
      listeners.add(listener);
      void initialize();
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => server,
    refresh,
    newThread,
    discussPurchase(proposalId: string) {
      const existing = snapshot.local.threads.find((t) => t.proposals.includes(proposalId));
      if (existing) return existing.id;
      const proposal = snapshot.proposals.find((p) => p.id === proposalId);
      if (!proposal) throw new Error("Refresh this purchasing record before discussing it.");
      const id = newThread(proposal.lines[0]?.name ?? "Purchase discussion", "Manual");
      editThread(id, (thread) => {
        thread.proposals = [proposalId];
      });
      answer(
        id,
        "You can ask about this purchase and its conditions. Only its buyer can withdraw or revise the original request; a review decision applies to the exact proposal shown.",
      );
      appendProposalTimeline(id, proposalId);
      return id;
    },
    sendMessage,
    createPurchase,
    createPurchaseFromRecipe,
    async reviseProposal(proposalId: string, body: ReviseProposalRequest, threadId?: string) {
      return single(`revise:${proposalId}`, async () => {
        if (!snapshot.user?.roles.includes("buyer"))
          throw new Error("A Buyer is required to revise this purchase.");
        const revised = await api.reviseProposal(proposalId, body);
        if (threadId) {
          const updated = await syncProposalToThread(
            revised.proposal,
            threadId,
            thread(threadId).source,
            keptPrevious(revised)
              ? "Change blocked by policy; previous proposal remains active."
              : revised.appliedChanges.join(" ") || "Updated purchase proposal.",
          );
          answer(
            threadId,
            keptPrevious(revised)
              ? "The revised proposal does not meet purchasing requirements. Your previous proposal remains active. Review the policy reasons below."
              : `Updated the proposal (${revised.appliedChanges.join(", ") || "revised items"}). Please review before continuing.`,
          );
          appendProposalTimeline(threadId, updated.id);
        } else {
          putProposal(revised.proposal);
          record(
            "Purchase proposal revised",
            revised.proposal.id,
            revised.appliedChanges.join(" "),
          );
        }
        await refresh();
        return revised;
      });
    },
    searchProducts,
    loadProduct,
    toSales,
    approve,
    placeOrder,
    async loadProposal(id: string) {
      const p = await api.getProposal(id);
      putProposal(p);
      return p;
    },
    async loadOrder(id: string) {
      const order = await api.getOrder(id);
      publish({ orders: [order, ...snapshot.orders.filter((o) => o.id !== id)] });
      await this.loadProposal(order.proposalId);
      return order;
    },
    async quote(productIds: string[], date: string) {
      const result = await api.getOffers(productIds, date);
      publish({ offers: result });
      return result;
    },
    async cancel(id: string) {
      putProposal(await api.cancelProposal(id));
      record("Purchase proposal withdrawn", id);
    },
    loadRecipes,
    loadRecipe,
    loadInventory,
    loadSettings,
    loadMembers,
    checkPlan,
    async checkAllPlans() {
      return single("check-all-plans", async () => {
        const plans = snapshot.local.plans.filter((p) => !p.paused);
        if (!plans.length) throw new Error("Create or resume a plan before running a check.");
        const runs: RestockRun[] = [];
        for (const plan of plans) runs.push(await checkPlan(plan.id));
        const combined: RestockRun = {
          id: uid("check"),
          planId: "all",
          at: stamp(),
          lines: runs.flatMap((r) => r.lines),
        };
        excludeOverlappingLines(combined.lines);
        local((l) => l.runs.unshift(combined));
        return combined;
      });
    },
    async createRecipe(body: CreateRecipeRequest) {
      const recipe = await api.createRecipe(body);
      publish({ recipes: [recipe, ...snapshot.recipes] });
      return recipe;
    },
    async discussRecipe(recipeId: string, portions: number, question: string) {
      const recipe = await loadRecipe(recipeId),
        id = newThread(`${recipe.name} · ${portions} portions`, "Recipes");
      editThread(id, (t) => {
        t.timeline!.push({ kind: "message", index: t.messages.length });
        t.messages.push({ role: "user", text: question, at: stamp() });
      });
      const ingredients = recipeNeeds(recipe, portions, snapshot.inventory);
      answer(
        id,
        `For ${portions} portions of ${recipe.name}, the recipe needs ${ingredients.map((r) => `${Number(r.needed.toFixed(3))} ${r.ingredient.unit} ${r.ingredient.productName}`).join(", ")}. Product availability and package conversions must be checked in the batch plan before purchasing.`,
      );
      return id;
    },
    async saveLayer(scope: LayerScope, body: UpdateLayerRequest) {
      await api.saveLayer(scope, body);
      await loadSettings();
      record("Organization purchasing settings updated", scope);
    },
    async createMember(body: CreateMemberRequest) {
      const member = await api.createMember(body);
      await loadMembers();
      return member;
    },
    async updateRoles(id: string, roles: Role[]) {
      await api.updateRoles(id, { roles });
      if (snapshot.user?.id === id) publish({ user: (await api.getMe()).user });
      if (snapshot.user?.roles.includes("approver")) await loadMembers();
      else publish({ members: [] });
    },
    savePlan(plan: RestockPlan) {
      const parsed = PlanSchema.parse(plan);
      local((l) => {
        l.plans = [parsed, ...l.plans.filter((p) => p.id !== plan.id)];
      });
      record(
        "Restocking plan configured locally",
        plan.id,
        "Background scheduling is not connected; run checks manually.",
      );
    },
    pausePlan(id: string) {
      local((l) => {
        const p = l.plans.find((p) => p.id === id);
        if (p) p.paused = !p.paused;
      });
    },
    deletePlan(id: string) {
      local((l) => {
        l.plans = l.plans.filter((p) => p.id !== id);
      });
    },
    linkRun(runId: string, threadId: string) {
      local((l) => {
        const run = l.runs.find((r) => r.id === runId);
        if (run) run.threadId = threadId;
      });
    },
    draft(id: string, text: string) {
      local((l) => {
        l.drafts[id] = text;
      });
    },
    async setRoles(roles: Role[]) {
      if (!options.mock || !options.capabilities) return;
      options.capabilities.setRoles(roles);
      publish({ user: (await api.getMe()).user });
      await refresh();
    },
    setFault(value: "none" | "price" | "expired") {
      options.capabilities?.setFault(value);
    },
    async reset() {
      if (!options.mock) return;
      epoch++;
      options.capabilities?.reset();
      publish({
        ...emptySnapshot(),
        ready: true,
        user: (await api.getMe()).user,
        local: emptyLocal("kitchen:anna"),
      });
      await refresh();
    },
    async prepareRun(id: string) {
      return single(`prepare-run:${id}`, async () => {
        const run = snapshot.local.runs.find((r) => r.id === id);
        if (!run) throw new Error("Check not found.");
        if (run.threadId) return { threadId: run.threadId };
        const ready = run.lines.filter((l) => l.state === "ready");
        if (!ready.length)
          throw new Error(
            "No confirmed items are ready. Resolve the items needing attention first.",
          );
        const latest = await api.listProposals();
        publish({ proposals: latest.items });
        if (
          latest.items.some(
            (p) =>
              ["READY", "PENDING_APPROVAL", "APPROVED"].includes(p.status) &&
              p.lines.some((line) => ready.some((item) => item.productId === line.productId)),
          )
        )
          throw new Error(
            "An open purchase already covers an item in this check. Review it or run a new check before preparing another proposal.",
          );
        const result = await createPurchase(
          {
            lines: ready.map((l) => ({ productId: l.productId, quantity: l.quantity })),
            date: today(),
          },
          run.conversationId,
          "Restocking",
        );
        local((l) => {
          const saved = l.runs.find((r) => r.id === id);
          if (saved) saved.threadId = result.threadId;
        });
        return result;
      });
    },
  };
}
export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
