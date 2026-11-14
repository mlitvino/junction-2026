import {
  AgentEventSchema,
  DemoStateSchema,
  IntentSchema,
  ProposalSchema,
  type ProvisionalActivity,
  type ProvisionalAgentEvent,
  type ProvisionalApproval,
  type ProvisionalDemoState,
  type ProvisionalProcurementService,
  type ProvisionalProposal,
  type ProvisionalRequest,
  type ProvisionalSnapshot,
} from "../provisional/types";
import { ProvisionalApiError } from "../provisional/errors";
import { demoProducts, demoScenarios, scenarioFixture } from "./scenarios";

export const DEMO_STORAGE_KEY = "aimo-procurement-demo-v1";
type DemoStorage = Pick<Storage, "getItem" | "setItem">;
const emptyState = (): ProvisionalDemoState => ({
  version: 1,
  nextId: 1,
  role: "BUYER",
  activeConversationId: null,
  conversations: [],
  intents: [],
  proposals: [],
  approvals: [],
  orders: [],
  activities: [],
  commits: [],
});

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

// Pure demo service: deterministic decisions, no network, authorization or security guarantees.
export function createMockProcurementService(
  options: {
    storage?: () => DemoStorage | null;
    wait?: () => Promise<void>;
    now?: () => string;
  } = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const wait = options.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
  const listeners = new Set<() => void>();
  const serverSnapshot: ProvisionalSnapshot = freeze({
    ready: false,
    mode: "mock",
    storageNotice: null,
    state: emptyState(),
    scenarios: demoScenarios,
    products: demoProducts,
  });
  let snapshot = serverSnapshot;
  let generation = 0;
  const emit = () => listeners.forEach((listener) => listener());
  function save(state: ProvisionalDemoState, notice = snapshot.storageNotice) {
    try {
      options.storage?.()?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    } catch {
      notice = "Local demo storage is unavailable. This demonstration will reset on refresh.";
    }
    snapshot = freeze({ ...snapshot, ready: true, state, storageNotice: notice });
    emit();
  }
  function initialize() {
    if (snapshot.ready) return;
    let state = emptyState();
    let notice: string | null = null;
    try {
      const raw = options.storage?.()?.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        state = DemoStateSchema.parse(JSON.parse(raw));
        // Schema validation alone cannot establish the demo's relational consistency.
        for (const approval of state.approvals) {
          const proposal = state.proposals.find((p) => p.id === approval.proposalId);
          if (
            !proposal ||
            proposal.proposalHash !== approval.proposalHash ||
            proposal.version !== approval.proposalVersion
          )
            throw new Error("Invalid demo approval reference");
        }
        for (const order of state.orders) {
          if (!state.proposals.some((p) => p.id === order.proposalId && p.orderId === order.id))
            throw new Error("Invalid demo order reference");
        }
        if (new Set(state.orders.map((o) => o.proposalId)).size !== state.orders.length)
          throw new Error("Duplicate demo order");
        for (const conversation of state.conversations) {
          if (conversation.status !== "RUNNING") continue;
          conversation.status = "INTERRUPTED";
          conversation.error = conversation.orderId
            ? "This demo run was interrupted after a local order was recorded. Review that order; it will not be repeated."
            : "This demo run was interrupted by a refresh. No purchase will complete automatically. Start a new demo request to try again.";
          const proposal = state.proposals.find((p) => p.id === conversation.proposalId);
          if (proposal && !proposal.orderId) proposal.status = "FAILED";
        }
      }
    } catch {
      notice =
        "Stored demo data was unavailable or invalid. A fresh local demonstration has been opened.";
      state = emptyState();
    }
    save(state, notice);
  }
  function update<T>(mutate: (draft: ProvisionalDemoState) => T): T {
    initialize();
    const state = structuredClone(snapshot.state);
    const result = mutate(state);
    save(DemoStateSchema.parse(state));
    return result;
  }
  const id = (state: ProvisionalDemoState, prefix: string) => `demo-${prefix}-${state.nextId++}`;
  function fail(code: string, message: string, status = 409): never {
    throw new ProvisionalApiError(code, message, status);
  }
  function requireRole(state: ProvisionalDemoState, role: ProvisionalDemoState["role"]) {
    if (state.role !== role)
      fail(
        "DEMO_ROLE_REQUIRED",
        `Switch to Demo ${role === "BUYER" ? "Buyer" : "Approver"} in the account menu. This is UI simulation, not authentication.`,
        403,
      );
  }
  function proposalById(state: ProvisionalDemoState, proposalId: string) {
    return (
      state.proposals.find((p) => p.id === proposalId) ??
      fail("NOT_FOUND", "This proposal is not in this tab’s local demo data.", 404)
    );
  }
  function activity(
    state: ProvisionalDemoState,
    proposal: ProvisionalProposal,
    action: string,
    explanation: string,
    actorType: ProvisionalActivity["actorType"] = "SYSTEM",
  ) {
    const entry: ProvisionalActivity = {
      id: id(state, "activity"),
      timestamp: now(),
      traceId: proposal.traceId,
      actorType,
      actorId: actorType === "USER" ? `demo-${state.role.toLowerCase()}` : "demo-simulator",
      action,
      resourceId: proposal.id,
      result: proposal.status,
      explanation,
    };
    state.activities.push(entry);
    return entry.id;
  }
  function commit(
    state: ProvisionalDemoState,
    proposalId: string,
    expectedVersion: number,
    key: string,
  ) {
    const replay = state.commits.find((item) => item.key === key);
    if (replay) {
      if (replay.proposalId !== proposalId || replay.expectedVersion !== expectedVersion)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "This demo request key was already used for a different purchase.",
        );
      return replay.orderId;
    }
    const proposal = proposalById(state, proposalId);
    if (proposal.version !== expectedVersion)
      fail("STALE_PROPOSAL", "The proposal version has changed. Review it again.");
    if (proposal.orderId) {
      state.commits.push({ key, proposalId, expectedVersion, orderId: proposal.orderId });
      return proposal.orderId;
    }
    if (proposal.status !== "READY" && proposal.status !== "APPROVED")
      fail("INVALID_STATE", "This proposal is not ready for a simulated order.");
    if (proposal.policyDecision.outcome === "DENY")
      fail("DEMO_PURCHASE_BLOCKED", "The scenario blocks this purchase.", 422);
    if (proposal.policyDecision.outcome === "REQUIRE_APPROVAL") {
      const approval = state.approvals.find((a) => a.id === proposal.approvalId);
      if (
        approval?.status !== "APPROVED" ||
        approval.proposalHash !== proposal.proposalHash ||
        approval.proposalVersion !== proposal.version
      )
        fail("APPROVAL_REQUIRED", "This exact proposal still needs a demo approval.", 422);
    }
    const intent = state.intents.find((i) => i.id === proposal.intentId);
    if (!intent || intent.revision !== proposal.intentRevision || intent.status !== "READY")
      fail("STALE_INTENT", "The request has changed. Start a new proposal.");
    const orderId = id(state, "order");
    proposal.status = "COMMITTED_SIMULATED";
    proposal.orderId = orderId;
    activity(
      state,
      proposal,
      "SIMULATED_ORDER_COMMITTED",
      "Created in this browser’s local simulator. No order was submitted to Valio.",
    );
    state.orders.push({
      id: orderId,
      proposalId,
      status: "SIMULATED_CONFIRMED",
      source: "LOCAL_SIMULATOR",
      upstreamOrderId: null,
      committedAt: now(),
      totalGross: proposal.totalGross,
      traceId: proposal.traceId,
      proposalSnapshot: structuredClone(proposal),
      intentSnapshot: structuredClone(intent),
      auditEventIds: state.activities
        .filter((a) => a.traceId === proposal.traceId)
        .map((a) => a.id),
    });
    state.commits.push({ key, proposalId, expectedVersion, orderId });
    for (const conversation of state.conversations.filter((c) => c.proposalId === proposalId))
      conversation.orderId = orderId;
    return orderId;
  }

  async function* streamAgentChat(
    request: ProvisionalRequest,
  ): AsyncGenerator<ProvisionalAgentEvent> {
    initialize();
    const scenario = demoScenarios.find((s) => s.id === request.scenarioId);
    if (!scenario || request.message.trim() !== scenario.prompt)
      fail(
        "UNSUPPORTED_DEMO_REQUEST",
        "This is a demo preview. This request is not configured in mock mode yet. Choose a prepared demo scenario to continue.",
        422,
      );
    const previous = snapshot.state.conversations.find(
      (c) => c.clientRequestId === request.clientRequestId,
    );
    if (previous) {
      if (
        previous.scenarioId !== request.scenarioId ||
        previous.messages[0]?.content !== request.message.trim()
      )
        fail(
          "IDEMPOTENCY_CONFLICT",
          "This request key has already been used for another demo request.",
        );
      return; // Replaying a completed or interrupted request NEVER restarts it.
    }
    requireRole(snapshot.state, "BUYER");
    if (snapshot.state.conversations.some((c) => c.status === "RUNNING"))
      fail("RUN_IN_PROGRESS", "A demo request is already running. Wait for it to finish.");
    const runGeneration = generation;
    const conversationId = update((state) => {
      const conversationId = id(state, "conversation"),
        runId = id(state, "run"),
        traceId = id(state, "trace");
      state.activeConversationId = conversationId;
      state.conversations.push({
        id: conversationId,
        title: scenario.label,
        scenarioId: scenario.id,
        updatedAt: now(),
        clientRequestId: request.clientRequestId,
        runId,
        traceId,
        status: "RUNNING",
        messages: [
          { id: id(state, "message"), role: "user", content: scenario.prompt, createdAt: now() },
        ],
        events: [],
        intentId: null,
        proposalId: null,
        orderId: null,
        error: null,
      });
      return conversationId;
    });
    const fixture = scenarioFixture(scenario.id, now());
    function record(event: ProvisionalAgentEvent["event"], data: unknown): ProvisionalAgentEvent {
      if (generation !== runGeneration)
        fail("DEMO_RESET", "The demo was reset. This run was stopped.");
      return update((state) => {
        const conversation = state.conversations.find((c) => c.id === conversationId)!;
        const item = AgentEventSchema.parse({
          event,
          data,
          runId: conversation.runId,
          traceId: conversation.traceId,
          sequence: conversation.events.length + 1,
          timestamp: now(),
        });
        conversation.events.push(item);
        conversation.updatedAt = item.timestamp;
        if (item.event === "message.delta")
          conversation.messages.push({
            id: id(state, "message"),
            role: "assistant",
            content: item.data.text,
            createdAt: now(),
          });
        if (item.event === "done") conversation.status = "DONE";
        if (item.event === "error") {
          conversation.status = "FAILED";
          conversation.error = item.data.error.message;
        }
        return item;
      });
    }
    try {
      yield record("status", {
        phase: "understanding",
        message: "Reading the prepared demo request…",
      });
      await wait();
      if (generation !== runGeneration) return;
      const intent = update((state) => {
        const intent = IntentSchema.parse({
          id: id(state, "intent"),
          revision: 1,
          status: "READY",
          originalText: scenario.prompt,
          requestedDeliveryDate: "2026-11-20",
          budgetGross: { currency: "EUR", amountMinor: fixture.budget },
          items: [
            {
              lineId: "demo-line-1",
              query: fixture.query,
              quantity: { value: fixture.quantity, unit: "L" },
              mandatoryClaims: [
                scenario.id === "allergen-blocked" ? "Milk-protein-free" : "Lactose-free",
              ],
              forbiddenAllergens: scenario.id === "allergen-blocked" ? ["Milk"] : [],
              allowSubstitutions: false,
              allowPartialDelivery: false,
            },
          ],
          preferences: {
            preferOrigin: scenario.id === "allergen-blocked" ? null : "FI",
            priceWeight: 1,
            reliabilityWeight: 0,
            carbonWeight: 0,
          },
          needsClarification: [],
          createdAt: now(),
          updatedAt: now(),
        });
        state.intents.push(intent);
        state.conversations.find((c) => c.id === conversationId)!.intentId = intent.id;
        return intent;
      });
      yield record("intent.ready", { intent });
      yield record("status", {
        phase: "catalog_search",
        message: "Loading products from the synthetic scenario…",
      });
      await wait();
      yield record("status", {
        phase: "offer_check",
        message: "Reading fixture prices and availability — no supplier request is made.",
      });
      await wait();
      yield record("status", {
        phase: "comparison",
        message: "Comparing the scenario’s prepared candidates…",
      });
      await wait();
      yield record("status", {
        phase: "policy_check",
        message: "Applying the scripted demonstration decision…",
      });
      await wait();
      if (generation !== runGeneration) return;
      const proposal = update((state) => {
        const proposalId = id(state, "proposal");
        const conversation = state.conversations.find((c) => c.id === conversationId)!;
        const proposal = ProposalSchema.parse({
          id: proposalId,
          intentId: intent.id,
          intentRevision: intent.revision,
          version: 1,
          status: fixture.outcome === "DENY" ? "BLOCKED" : "READY",
          // Not a cryptographic hash: a local version token for demonstration consistency only.
          proposalHash: `${proposalId}:v1:${intent.id}:r1`,
          lines: [
            {
              requestedLineId: "demo-line-1",
              productId: fixture.productId,
              requestedQuantity: { value: fixture.quantity, unit: "L" },
              selectedSalesQuantity: { value: fixture.quantity, unit: "ST" },
              estimatedPhysicalQuantity: { value: fixture.quantity, unit: "L" },
              unitPriceGross: fixture.evidence.offer.priceGross,
              lineTotalGross: { currency: "EUR", amountMinor: fixture.total },
              evidence: fixture.evidence,
            },
          ],
          alternatives: fixture.alternatives,
          totalGross: { currency: "EUR", amountMinor: fixture.total },
          totalNet: null,
          unknownCharges: [],
          policyDecision: {
            outcome: fixture.outcome,
            reasons: [fixture.reason],
            evaluatedAt: now(),
            policyVersion: 1,
          },
          approvalId: null,
          orderId: null,
          createdAt: now(),
          traceId: conversation.traceId,
        });
        state.proposals.push(proposal);
        conversation.proposalId = proposal.id;
        activity(
          state,
          proposal,
          "PROPOSAL_CREATED",
          "Prepared proposal version 1 from synthetic scenario data.",
          "AGENT",
        );
        activity(state, proposal, `POLICY_${fixture.outcome}`, fixture.reason.message, "AGENT");
        return proposal;
      });
      yield record("proposal.ready", { proposal });
      if (fixture.outcome === "ALLOW") {
        yield record("status", {
          phase: "commit",
          message: "Recording one order in the local browser simulator…",
        });
        await wait();
        if (generation !== runGeneration) return;
        const orderId = update((state) =>
          commit(state, proposal.id, proposal.version, `${request.clientRequestId}:auto`),
        );
        yield record("order.committed", {
          order: snapshot.state.orders.find((o) => o.id === orderId)!,
        });
      }
      if (fixture.outcome === "REQUIRE_APPROVAL") {
        yield record("status", {
          phase: "approval",
          message: "Your review is needed before this proposal can be sent for demo approval.",
        });
      }
      const text =
        fixture.outcome === "ALLOW"
          ? "Your simulated purchase has been recorded locally. Nothing was submitted to Valio."
          : fixture.outcome === "REQUIRE_APPROVAL"
            ? "I’ve prepared a demo recommendation. It exceeds the fictional agent limit. Review it and send it to a Demo Approver."
            : "I can’t confirm the mandatory milk-allergen requirement in this fixture. The purchase is blocked. Review the missing evidence or revise the request.";
      yield record("message.delta", { text });
      yield record("done", {
        conversationId,
        intentId: intent.id,
        proposalId: proposal.id,
        ...(snapshot.state.proposals.find((p) => p.id === proposal.id)!.orderId
          ? { orderId: snapshot.state.proposals.find((p) => p.id === proposal.id)!.orderId }
          : {}),
      });
    } catch (error) {
      if (generation !== runGeneration) return;
      yield record("error", {
        error: {
          code: "DEMO_RUN_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "The demo run stopped. Start a new request to try again.",
        },
      });
    }
  }

  const service: ProvisionalProcurementService & { streamAgentChat: typeof streamAgentChat } = {
    initialize,
    subscribe(listener) {
      listeners.add(listener);
      initialize();
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    streamAgentChat,
    async startConversation(request) {
      for await (const event of streamAgentChat(request)) {
        void event;
      }
      return (
        snapshot.state.conversations.find((c) => c.clientRequestId === request.clientRequestId)
          ?.id ?? ""
      );
    },
    async requestApproval(proposalId, expectedVersion) {
      return update((state) => {
        requireRole(state, "BUYER");
        const proposal = proposalById(state, proposalId);
        if (proposal.version !== expectedVersion)
          fail("STALE_PROPOSAL", "The proposal changed. Review the latest version.");
        if (proposal.approvalId) return proposal.approvalId;
        if (proposal.status !== "READY" || proposal.policyDecision.outcome !== "REQUIRE_APPROVAL")
          fail("INVALID_STATE", "This proposal cannot be sent for approval.");
        const approval: ProvisionalApproval = {
          id: id(state, "approval"),
          proposalId,
          proposalHash: proposal.proposalHash,
          proposalVersion: proposal.version,
          status: "PENDING",
          requestedAt: now(),
          reasons: proposal.policyDecision.reasons,
          decidedByUserId: null,
          decidedAt: null,
          note: null,
        };
        state.approvals.push(approval);
        proposal.approvalId = approval.id;
        proposal.status = "PENDING_APPROVAL";
        activity(
          state,
          proposal,
          "APPROVAL_REQUESTED",
          "Sent this exact proposal version to the Demo Approver.",
          "USER",
        );
        return approval.id;
      });
    },
    async commitOrder(proposalId, expectedVersion, key) {
      if (!key.trim()) fail("INVALID_KEY", "A demo idempotency key is required.", 400);
      return update((state) => {
        requireRole(state, "BUYER");
        return commit(state, proposalId, expectedVersion, key);
      });
    },
    async decideApproval(approvalId, expectedHash, decision, note) {
      update((state) => {
        requireRole(state, "APPROVER");
        const approval =
          state.approvals.find((a) => a.id === approvalId) ??
          fail("NOT_FOUND", "This approval is not in this tab’s local demo data.", 404);
        const proposal = proposalById(state, approval.proposalId);
        if (
          expectedHash !== approval.proposalHash ||
          proposal.proposalHash !== expectedHash ||
          proposal.version !== approval.proposalVersion
        )
          fail(
            "STALE_APPROVAL",
            "The proposal version no longer matches this approval. Review it again.",
          );
        if (approval.status === decision) return;
        if (approval.status !== "PENDING" || proposal.status !== "PENDING_APPROVAL")
          fail(
            "ALREADY_DECIDED",
            "This demo request has already been decided. Its decision cannot be changed.",
          );
        if (decision === "REJECTED" && !note.trim())
          fail("REASON_REQUIRED", "Add a reason for rejecting this demo request.", 422);
        approval.status = decision;
        approval.decidedAt = now();
        approval.decidedByUserId = "demo-approver";
        approval.note = note.trim() || null;
        proposal.status = decision;
        activity(
          state,
          proposal,
          `APPROVAL_${decision}`,
          decision === "APPROVED"
            ? "Demo Approver approved this exact proposal. This is not real authorization."
            : `Demo Approver rejected the request: ${note.trim()}`,
          "USER",
        );
        if (decision === "APPROVED")
          commit(state, proposal.id, proposal.version, `${approval.id}:approved`);
      });
    },
    async setDemoRole(role) {
      update((state) => {
        state.role = role;
      });
    },
    async resetDemo() {
      generation++;
      save(emptyState(), null);
    },
  };
  return service;
}
