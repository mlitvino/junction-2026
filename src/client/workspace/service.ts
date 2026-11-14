import type { CreateProposalRequest, Proposal } from "@/shared/contracts/purchasing";
import { CreateProposalRequestSchema } from "@/shared/contracts/purchasing";
import type { Role } from "@/shared/contracts/me";
import type {
  Recipe,
  CreateRecipeRequest,
  CreateOrderFromRecipeRequest,
} from "@/shared/contracts/recipes";
import type { InventoryItem } from "@/shared/contracts/inventory";
import type { LayerScope, UpdateLayerRequest } from "@/shared/contracts/preferences";
import type { CreateMemberRequest } from "@/shared/contracts/organization";
import { ApiError, type WorkspaceApi } from "./http";
import {
  LocalSchema,
  PlanSchema,
  emptySnapshot,
  emptyLocal,
  type WorkspaceSnapshot,
  type RestockPlan,
  type Thread,
  type RestockRun,
} from "./model";

export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const stamp = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export function compatibleQuantity(quantity: number, from: string, to: string): number | null {
  const units: Record<string, { group: string; ratio: number }> = {
    KG: { group: "mass", ratio: 1 },
    G: { group: "mass", ratio: 0.001 },
    L: { group: "volume", ratio: 1 },
    DL: { group: "volume", ratio: 0.1 },
    CL: { group: "volume", ratio: 0.01 },
    ML: { group: "volume", ratio: 0.001 },
  };
  const a = from.toUpperCase(),
    b = to.toUpperCase();
  if (a === b) return quantity;
  return units[a] && units[b] && units[a].group === units[b].group
    ? (quantity * units[a].ratio) / units[b].ratio
    : null;
}
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
    .replace(/\b(order|buy|purchase|need|want|get|send|deliver(?:ed)?|tomorrow|today|please|of|for|by|some|me|i)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    quantity: quantity && Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unit,
    query: stripped || text.trim(),
  };
}
export function recipeNeeds(recipe: Recipe, servings: number, inventory: InventoryItem[]) {
  const grouped: Recipe["ingredients"] = [];
  for (const ingredient of recipe.ingredients) {
    const previous = grouped.find(
      (i) =>
        i.productName.toLowerCase() === ingredient.productName.toLowerCase() &&
        compatibleQuantity(ingredient.quantity, ingredient.unit, i.unit) !== null,
    );
    if (previous)
      previous.quantity += compatibleQuantity(ingredient.quantity, ingredient.unit, previous.unit)!;
    else grouped.push({ ...ingredient });
  }
  return grouped.map((ingredient) => {
    const needed = (ingredient.quantity * servings) / recipe.baseServings;
    const stock = inventory.filter(
      (i) => i.ingredientName.toLowerCase() === ingredient.productName.toLowerCase(),
    );
    const usable = stock.reduce(
      (sum, i) => sum + (compatibleQuantity(i.quantityInStock, i.unit, ingredient.unit) ?? 0),
      0,
    );
    return {
      ingredient,
      needed,
      stock: usable,
      shortage: Math.max(0, needed - usable),
      inventory: stock,
    };
  });
}

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
      if (t) apply(t);
    });
  }
  function answer(id: string, text: string) {
    editThread(id, (t) => t.messages.push({ role: "assistant", text, at: stamp() }));
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
  ) {
    return single(`create:${threadId ?? JSON.stringify(body)}`, async () => {
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
      // Never mark an old version superseded until the server has actually cancelled it.
      if (replaceId) {
        const old = await api.getProposal(replaceId);
        if (["READY", "PENDING_APPROVAL", "APPROVED"].includes(old.status)) {
          const cancelled = await api.cancelProposal(old.id);
          putProposal(cancelled);
          record(
            "Previous proposal withdrawn after a change",
            old.id,
            `Replaced revision in ${id}`,
          );
        } else if (old.status === "ORDERED")
          throw new Error("A recorded order cannot be edited. Start a separate purchase request.");
      }
      const created = await api.createProposal(body);
      record(
        "Purchase proposal prepared",
        created.id,
        `Source: ${source}. Prices excluding VAT. ${created.hash}`,
      );
      const current = await syncProposalToThread(
        created,
        id,
        source,
        replaceId
          ? "A new purchase proposal replaces the previous quantity, products or delivery requirements."
          : undefined,
      );
      answer(
        id,
        current.status === "BLOCKED"
          ? "This purchase does not meet the purchasing requirements. You can change the request or review the reasons below."
          : "I’ve prepared a purchase proposal. Please review the products, quantity and conditions before continuing.",
      );
      return { threadId: id, proposal: current };
    });
  }
  async function createPurchaseFromRecipe(
    body: CreateOrderFromRecipeRequest,
    threadId?: string,
  ) {
    return single(`recipe:${threadId ?? body.recipeId ?? body.dishQuery ?? "custom"}`, async () => {
      if (!snapshot.user?.roles.includes("buyer"))
        throw new Error("A Buyer is required to prepare this purchase.");
      const result = await api.createProposalFromRecipe(body);
      const id =
        threadId ??
        newThread(
          `${result.recipeUsed.name} · ${result.requestedServings} portions`,
          "Recipes",
        );
      let current: Proposal | null = null;
      if (result.proposal) {
        record(
          "Recipe purchase proposal prepared",
          result.proposal.id,
          `${result.recipeUsed.name}, ${result.requestedServings} portions.`,
        );
        current = await syncProposalToThread(result.proposal, id, "Recipes");
      }
      const covered = result.ingredientReconciliation.filter((r) => r.coveredByInventory).length;
      const ordered = result.ingredientReconciliation.filter((r) => !r.coveredByInventory).length;
      answer(
        id,
        `${result.message} Inventory check: ${covered} covered by kitchen stock, ${ordered} need ordering.`,
      );
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
    const direct = compatibleQuantity(quantity, unit, product.salesUnit);
    if (direct !== null) return direct;
    if (product.contentPerSalesUnit && product.contentPerSalesUnit.value > 0) {
      const inContent = compatibleQuantity(quantity, unit, product.contentPerSalesUnit.unit);
      if (inContent !== null) return Math.ceil(inContent / product.contentPerSalesUnit.value);
    }
    const unitInfo = product.units.find((u) => u.unitId === product.salesUnit);
    if (unitInfo?.sizeInBaseUnits) {
      const inBase = compatibleQuantity(quantity, unit, product.baseUnit);
      if (inBase !== null) return Math.ceil(inBase / unitInfo.sizeInBaseUnits);
      const kg = compatibleQuantity(quantity, unit, "KG");
      if (kg !== null && product.netWeightKg)
        return Math.ceil(kg / (product.netWeightKg * unitInfo.sizeInBaseUnits));
    }
    return null;
  }
  async function handleRestockSetup(id: string, text: string, current?: Proposal) {
    await loadInventory();
    if (current && ["READY", "PENDING_APPROVAL", "APPROVED"].includes(current.status)) {
      putProposal(await api.cancelProposal(current.id));
      record("Previous purchase withdrawn for restocking changes", current.id);
    }
    const requested = text
      .match(/(?:restock|replenish)\s+(.+?)(?:\s+to\s|\s+instead|$)/i)?.[1]
      ?.toLowerCase();
    const item = requested
      ? snapshot.inventory.find((i) => i.ingredientName.toLowerCase().includes(requested))
      : undefined;
    if (item) {
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
    answer(
      id,
      "Let’s set the product, trigger level and target stock. Restocking plans are configured locally until background scheduling is connected.",
    );
    editThread(id, (t) => {
      t.query = "restocking";
    });
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
    const quantity = Number(
      text.match(/(?:make|change|set|order|need|buy|to)\s+(?:it\s+)?([\d,.]+)/i)?.[1]?.replace(/,/g, ""),
    );
    const quantityOnly =
      /^(?:make|change|set)(?:\s+it|\s+the quantity)?\s+(?:to\s+)?[\d,.]+(?:\s*(?:kg|g|dl|cl|ml|litres?|liters?|l|st|kpl|pcs|cases?))?[.!]?$/i.test(
        text,
      );
    if (current && current.status !== "ORDERED" && quantityOnly && Number.isFinite(quantity) && quantity > 0) {
      const first = current.lines[0];
      if (!first) throw new Error("This purchase has no items to revise.");
      const rawUnit =
        text.match(/\b(kg|g|dl|cl|ml|litres?|liters?|l|st|kpl|pcs|cases?)\b/i)?.[1]?.toUpperCase() ??
        first.salesUnit ??
        "ST";
      const normalized = /^LIT/.test(rawUnit)
        ? "L"
        : /^CASE/.test(rawUnit)
          ? "KI"
          : rawUnit === "PCS" || rawUnit === "KPL"
            ? "ST"
            : rawUnit;
      const sales = await toSales(first.productId, quantity, normalized);
      if (sales === null) {
        answer(
          id,
          `I need a verified conversion from ${normalized} to ${first.salesUnit ?? "sales units"}. Confirm the quantity below; the current proposal has not changed.`,
        );
        editThread(id, (t) => {
          t.query = first.name;
        });
        return;
      }
      editThread(id, (t) => {
        t.stage = "Updating purchase proposal";
      });
      const revised = await api.reviseProposal(current.id, {
        quantityUpdates: [{ productId: first.productId, quantity: sales }],
      });
      const updated = await syncProposalToThread(
        revised.proposal,
        id,
        thread(id).source,
        revised.appliedChanges.join(" ") ||
          "A new purchase proposal replaces the previous quantity.",
      );
      await refresh();
      answer(
        id,
        updated.status === "BLOCKED"
          ? "The updated proposal does not meet purchasing requirements. Review the policy reasons below."
          : `Updated the proposal (${revised.appliedChanges.join(", ") || `${sales} ${first.salesUnit ?? "units"}`}). Please review before continuing.`,
      );
      return;
    }
    editThread(id, (t) => {
      t.stage = "Finding suitable products & checking policy";
    });
    try {
      const result = await api.runAgent({
        message: text,
        ...(current && current.status !== "ORDERED" ? { proposalId: current.id } : {}),
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
        editThread(id, (t) => {
          t.query = "";
          t.recipeChoice = false;
        });
        const warnings = synced.selection?.warnings ?? [];
        answer(
          id,
          warnings.length
            ? `${result.reply}\n\nNote: ${warnings.join(" ")}`
            : result.reply,
        );
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
      editThread(id, (t) => {
        t.query = parsed.query;
      });
    } catch (error) {
      const agentUnavailable =
        error instanceof ApiError &&
        (error.status === 503 || error.code === "AGENT_NOT_CONFIGURED" || error.code === "MODEL_FAILED");
      if (!agentUnavailable) throw error;
      if (/recipe|portions|servings/i.test(text)) {
        const recipes = await loadRecipes();
        const servings = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:portions|servings)/i)?.[1]);
        const matched = recipes.find((r) =>
          text.toLowerCase().includes(r.name.toLowerCase().split(" (")[0]!.toLowerCase()) ||
          r.tags.some((tag) => text.toLowerCase().includes(tag.replace("-", " "))),
        );
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
      editThread(id, (t) => {
        t.query = query;
      });
    }
  }
  async function sendMessage(id: string, message: string) {
    return single(`message:${id}`, async () => {
      const text = message.trim();
      if (!text) return;
      const runEpoch = epoch;
      editThread(id, (t) => {
        t.messages.push({ role: "user", text, at: stamp() });
        t.working = true;
        t.error = undefined;
        t.stage = "Understanding your request";
      });
      try {
        const current = snapshot.proposals.find((p) => p.id === thread(id).proposals.at(-1));
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
          return;
        }
        if (!options.mock) {
          await handleConnectedMessage(id, text, current);
          return;
        }
        if (/recipe|macaroni|meal|portions/i.test(text)) {
          if (current && ["READY", "PENDING_APPROVAL", "APPROVED"].includes(current.status)) {
            putProposal(await api.cancelProposal(current.id));
            record("Previous purchase withdrawn for recipe planning", current.id);
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
        const quantity = Number(
          text
            .match(/(?:make|change|set|order|need|buy|to)\s+(?:it\s+)?([\d,.]+)/i)?.[1]
            ?.replace(/,/g, ""),
        );
        const quantityOnly =
          /^(?:make|change|set)(?:\s+it|\s+the quantity)?\s+(?:to\s+)?[\d,.]+(?:\s*(?:kg|litres?|liters?|l|st|cases?))?[.!]?$/i.test(
            text,
          );
        if (current && quantityOnly && Number.isFinite(quantity) && quantity > 0) {
          const unit =
            text.match(/\b(kg|litres?|liters?|l|st|cases?)\b/i)?.[1]?.toUpperCase() ??
            current.lines[0]?.salesUnit ??
            "ST";
          const normalized = /^LIT/.test(unit) ? "L" : /^CASE/.test(unit) ? "KI" : unit;
          const first = current.lines[0];
          if (!first) throw new Error("This purchase has no items to revise.");
          const sales = await toSales(first.productId, quantity, normalized);
          if (sales === null) {
            answer(
              id,
              `I need a verified conversion from ${normalized} to ${first.salesUnit}. Please confirm the quantity in sales units using the product picker; the current proposal has not changed.`,
            );
            editThread(id, (t) => {
              t.query = first.name;
            });
            return;
          }
          await createPurchase(
            {
              lines: current.lines.map((l, i) => ({
                productId: l.productId,
                quantity: i === 0 ? sales : l.quantity,
              })),
              date: current.pricingDate,
              note: text,
            },
            id,
            thread(id).source,
            current.id,
          );
          return;
        }
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
            });
            await createPurchase(
              { lines: [{ productId: p.id, quantity: sales }], date: "2026-11-20", note: text },
              id,
              thread(id).source,
              current?.status === "ORDERED" ? undefined : current?.id,
            );
            return;
          }
        }
        editThread(id, (t) => {
          t.query = query;
        });
        answer(
          id,
          "Choose the product and confirm its sales-unit quantity below. I’ll prepare it for review.",
        );
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
  async function checkPlan(planId: string) {
    const plan = snapshot.local.plans.find((p) => p.id === planId);
    if (!plan) throw new Error("Restocking plan not found.");
    const stock = await loadInventory();
    const match = stock.find(
      (i) => i.id === plan.inventoryId || i.linkedProductId === plan.productId,
    );
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
    const state = existing
      ? "partial"
      : amount === 0
        ? "covered"
        : !offer?.price?.found ||
            !availability?.orderable ||
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
          reason: existing
            ? "An open purchase already includes this product. Review it to avoid duplicate coverage; inventory has not been reserved."
            : state === "ready"
              ? "A purchase can be prepared for review."
              : state === "covered"
                ? "Stock is above the configured trigger. No purchase is needed."
                : "Excluded from purchase until quantity, date or availability is confirmed.",
        },
      ],
    };
    local((l) => l.runs.unshift(run));
    record(
      "Restocking check completed",
      run.id,
      "Manual check. No server scheduler or inventory reservation is active.",
    );
    return run;
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
      return id;
    },
    sendMessage,
    createPurchase,
    createPurchaseFromRecipe,
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
        const counts = new Map<string, number>();
        for (const line of combined.lines)
          counts.set(line.productId, (counts.get(line.productId) ?? 0) + 1);
        for (const line of combined.lines)
          if ((counts.get(line.productId) ?? 0) > 1 && line.state !== "covered") {
            line.state = "partial";
            line.reason =
              "Several plans reference this product. Consolidate their stock targets before purchasing to avoid duplicate coverage.";
          }
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
      editThread(id, (t) => t.messages.push({ role: "user", text: question, at: stamp() }));
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
      const run = snapshot.local.runs.find((r) => r.id === id);
      if (!run) throw new Error("Check not found.");
      if (run.threadId) return { threadId: run.threadId };
      const ready = run.lines.filter((l) => l.state === "ready");
      if (!ready.length)
        throw new Error("No confirmed items are ready. Resolve the items needing attention first.");
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
        undefined,
        "Restocking",
      );
      this.linkRun(id, result.threadId);
      return result;
    },
  };
}
export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
