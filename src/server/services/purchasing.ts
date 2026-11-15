import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { mergeDraftLines } from "@/server/policy/evaluate";
import {
  approval,
  organization,
  proposal,
  purchaseOrder,
  user,
  valioPriceSnapshot,
  valioProduct,
  type ApprovalRow,
  type ProposalRow,
  type PurchaseOrderRow,
  type StoredDecision,
  type StoredProposalLine,
} from "@/server/db/schema";
import {
  approvalExpiry,
  canCancel,
  canDecide,
  canOrder,
  canRequestApproval,
  checkLiveOffer,
  checkQuote,
  contentHash,
  initialStatus,
  quoteExpiresAt,
  type LiveLineCheck,
  type RuleResult,
} from "@/server/purchasing/rules";
import { revisionsOf, withPricingSteps, type PricedProposal } from "@/server/purchasing/story";
import type { PolicyOutcome } from "@/shared/contracts/policy";
import type {
  Approval,
  ApprovalStatus,
  ApprovalWithProposal,
  CreateProposalRequest,
  DecideApprovalRequest,
  ListApprovalsQuery,
  ListProposalsQuery,
  Order,
  PendingApprovalCount,
  OrderReceipt,
  Proposal,
  ProposalSelection,
  ProposalSource,
  ProposalStatus,
  ProposalVerification,
  ReviseProposalResponse,
} from "@/shared/contracts/purchasing";

import { recordAudit, type AuditActor, type AuditEntry } from "./audit";
import { getAvailability, getPrices, today } from "./catalog";
import { evaluateDraft } from "./policy";
import { checkProposalSignature, signProposalContent } from "./trust";

// The one purchasing flow: proposals, approvals, orders. Every function takes the caller (their
// organization and user) and only touches that organization's rows. Rules: server/purchasing/rules.ts.
// State changes lock the proposal row (SELECT … FOR UPDATE), so concurrent clicks can't both win,
// and write the audit log in the same transaction. The agent's prompt/recipe pipeline
// (services/orders.ts) ends in `createProposal` too, so its proposals obey the same rules.

/** Expected failures, mapped to HTTP statuses by the routes. */
export class PurchasingError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422;
  readonly code: string;
  constructor(status: 400 | 403 | 404 | 409 | 422, code: string, message: string) {
    super(message);
    this.name = "PurchasingError";
    this.status = status;
    this.code = code;
  }
}

/** The signed-in user (or the agent acting for them) the call is made for. */
export type Actor = AuditActor & { userId: string };

export function actorFor(user: { id: string; username: string; organization: { id: string } }, agent = false): Actor {
  return { organizationId: user.organization.id, userId: user.id, userName: user.username, agent };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Db = Tx | ReturnType<typeof getDb>;

async function db() {
  await ensureDatabase();
  return getDb();
}

function enforce(result: RuleResult) {
  if (!result.ok) throw new PurchasingError(result.status, result.code, result.message);
}

const notFound = (what: string) => new PurchasingError(404, "NOT_FOUND", `${what} not found`);
const eur = (n: number | null) => (n === null ? "unknown total" : `€${n.toFixed(2)}`);

// ---------- Mapping ----------

/** Usernames for user ids (one query). */
async function usernames(d: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const rows = await d.select({ id: user.id, username: user.username }).from(user).where(inArray(user.id, unique));
  return new Map(rows.map((r) => [r.id, r.username ?? r.id]));
}

function toApproval(row: ApprovalRow, names: Map<string, string>, quoteExpiresAt: Date | null): Approval {
  return {
    id: row.id,
    proposalId: row.proposalId,
    proposalHash: row.proposalHash,
    status: row.status as ApprovalStatus,
    requestedBy: row.requestedBy,
    requestedByName: names.get(row.requestedBy) ?? null,
    requestedAt: row.requestedAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedByName: row.decidedBy ? (names.get(row.decidedBy) ?? null) : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    comment: row.comment,
    expiresAt: approvalExpiry(row.expiresAt, quoteExpiresAt)?.toISOString() ?? null,
  };
}

/** Rows from before availability was frozen have no availability fields. */
function withAvailability(line: StoredProposalLine) {
  return {
    ...line,
    orderable: line.orderable ?? null,
    availableDate: line.availableDate ?? null,
    availableQuantity: line.availableQuantity ?? null,
    substituteFor: line.substituteFor ?? null,
  };
}

function toProposal(
  row: ProposalRow,
  approvalRow: ApprovalRow | null,
  orderId: string | null,
  names: Map<string, string>,
): Proposal {
  return {
    id: row.id,
    status: row.status as ProposalStatus,
    createdBy: row.createdBy,
    createdByName: names.get(row.createdBy) ?? null,
    source: (row.source as ProposalSource | null) ?? null,
    selection: (row.selection as ProposalSelection | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map(withAvailability),
    totalExclVat: row.totalExclVat,
    currency: row.currency,
    pricingDate: row.pricingDate,
    priceSource: row.priceSource as Proposal["priceSource"],
    quoteExpiresAt: row.quoteExpiresAt?.toISOString() ?? null,
    decision: row.decision as Proposal["decision"],
    hash: row.hash,
    signature: row.signature,
    signatureKeyId: row.signatureKeyId,
    note: row.note,
    approval: approvalRow ? toApproval(approvalRow, names, row.quoteExpiresAt) : null,
    orderId,
  };
}

function toOrder(row: PurchaseOrderRow, names: Map<string, string>): Order {
  return {
    id: row.id,
    proposalId: row.proposalId,
    status: "SIMULATED_CONFIRMED",
    source: "LOCAL_SIMULATOR",
    createdBy: row.createdBy,
    createdByName: names.get(row.createdBy) ?? null,
    createdAt: row.createdAt.toISOString(),
    idempotencyKey: row.idempotencyKey,
    proposalHash: row.proposalHash,
    lines: row.lines.map(withAvailability),
    totalExclVat: row.totalExclVat,
    currency: row.currency,
  };
}

/** Proposals with their approval, order id and usernames, in the given order. */
async function withRelations(d: Db, rows: ProposalRow[]): Promise<Proposal[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [approvals, orders] = await Promise.all([
    d.select().from(approval).where(inArray(approval.proposalId, ids)),
    d
      .select({ id: purchaseOrder.id, proposalId: purchaseOrder.proposalId })
      .from(purchaseOrder)
      .where(inArray(purchaseOrder.proposalId, ids)),
  ]);
  const names = await usernames(d, [
    ...rows.map((r) => r.createdBy),
    ...approvals.flatMap((a) => [a.requestedBy, a.decidedBy]),
  ]);
  const approvalBy = new Map(approvals.map((a) => [a.proposalId, a]));
  const orderBy = new Map(orders.map((o) => [o.proposalId, o.id]));
  return rows.map((r) => toProposal(r, approvalBy.get(r.id) ?? null, orderBy.get(r.id) ?? null, names));
}

async function ordersWithNames(d: Db, rows: PurchaseOrderRow[]): Promise<Order[]> {
  const names = await usernames(d, rows.map((r) => r.createdBy));
  return rows.map((r) => toOrder(r, names));
}

/** Locks one proposal of the organization for the rest of the transaction. */
async function lockProposal(tx: Tx, organizationId: string, id: string): Promise<ProposalRow> {
  const [row] = await tx
    .select()
    .from(proposal)
    .where(and(eq(proposal.id, id), eq(proposal.organizationId, organizationId)))
    .for("update");
  if (!row) throw notFound("Proposal");
  return row;
}

async function setProposalStatus(tx: Tx, id: string, status: ProposalStatus) {
  await tx.update(proposal).set({ status, updatedAt: new Date() }).where(eq(proposal.id, id));
}

async function reload(tx: Tx, id: string): Promise<Proposal> {
  const [fresh] = await tx.select().from(proposal).where(eq(proposal.id, id));
  return (await withRelations(tx, [fresh!]))[0]!;
}

// ---------- Proposals ----------

export type CreateProposalOptions = {
  source?: ProposalSource;
  selection?: ProposalSelection | null;
  /** Extra audit entries about how the proposal was prepared (e.g. the agent's search steps). */
  preparation?: Omit<AuditEntry, "resourceType" | "resourceId">[];
  /**
   * Called once the lines are priced and the policy has decided, before anything is stored: it can
   * replace the selection and add audit entries that depend on the result (budget comparison, the
   * story's steps). Pure and synchronous.
   */
  onPriced?: (priced: PricedProposal) => {
    selection?: ProposalSelection | null;
    preparation?: Omit<AuditEntry, "resourceType" | "resourceId">[];
  };
};

/** Prices the lines, runs the policy check and freezes the result. Network first, then one insert. */
export async function createProposal(
  actor: Actor,
  request: CreateProposalRequest,
  options: CreateProposalOptions = {},
): Promise<Proposal> {
  // Goods can't be delivered in the past (Helsinki date); today is fine.
  if (request.date && request.date < today())
    throw new PurchasingError(422, "DATE_IN_PAST", `The delivery date ${request.date} is in the past. Pick today or a later date.`);
  const mergedRequestLines = mergeDraftLines(request.lines);
  const decision = await evaluateDraft(actor.organizationId, { ...request, lines: mergedRequestLines });
  const d = await db();
  const ids = [...new Set(mergedRequestLines.map((l) => l.productId))];
  const products = await d
    .select({ id: valioProduct.id, name: valioProduct.name, vendorName: valioProduct.vendorName })
    .from(valioProduct)
    .where(inArray(valioProduct.id, ids));
  const productBy = new Map(products.map((p) => [p.id, p]));

  const lines: StoredProposalLine[] = decision.lines.map((l) => ({
    productId: l.productId,
    name: productBy.get(l.productId)?.name ?? "Unknown product",
    vendorName: productBy.get(l.productId)?.vendorName ?? "",
    quantity: l.quantity,
    salesUnit: l.salesUnit,
    unitPriceExclVat: l.unitPriceExclVat,
    lineTotalExclVat: l.lineTotalExclVat,
    orderable: l.orderable,
    availableDate: l.availableDate,
    availableQuantity: l.availableQuantity,
    substituteFor: mergedRequestLines.find((r) => r.productId === l.productId)?.substituteFor ?? null,
    priceSnapshotId: l.priceSnapshotId,
    availabilitySnapshotId: l.availabilitySnapshotId,
  }));
  const stored: StoredDecision = {
    outcome: decision.outcome,
    reasons: decision.reasons,
    limits: decision.limits,
    evaluatedAt: decision.evaluatedAt,
  };
  const frozen = {
    lines,
    totalExclVat: decision.totalExclVat,
    currency: decision.currency,
    pricingDate: decision.pricingDate,
    priceSource: decision.source,
    decision: stored,
  };
  const createdAt = new Date();
  const expiresAt = quoteExpiresAt(createdAt);
  const source = options.source ?? "buyer";
  // The expiry is part of the deal, so the hash covers it too. The id is made here so it can be signed.
  const id = randomUUID();
  const hash = contentHash({ ...frozen, quoteExpiresAt: expiresAt.toISOString() });
  const status = initialStatus(decision.outcome);
  const priced = options.onPriced?.({
    id,
    status,
    hash,
    lineCount: lines.length,
    totalExclVat: decision.totalExclVat,
    currency: decision.currency,
    pricingDate: decision.pricingDate,
    decision,
  });
  const selection = priced?.selection !== undefined ? priced.selection : (options.selection ?? null);
  const preparation = [...(options.preparation ?? []), ...(priced?.preparation ?? [])];

  return d.transaction(async (tx) => {
    const [row] = await tx
      .insert(proposal)
      .values({
        id,
        organizationId: actor.organizationId,
        createdBy: actor.userId,
        status,
        outcome: decision.outcome,
        hash,
        ...signProposalContent({ proposalId: id, hash }),
        note: request.note || null,
        createdAt,
        updatedAt: createdAt,
        quoteExpiresAt: expiresAt,
        source,
        selection: selection as Record<string, unknown> | null,
        ...frozen,
      })
      .returning();
    const created = row!;
    await recordAudit(tx, actor, [
      ...preparation.map((p) => ({ ...p, resourceType: "proposal" as const, resourceId: created.id })),
      {
        action: "proposal.created",
        resourceType: "proposal",
        resourceId: created.id,
        summary: `Created a proposal with ${lines.length} line(s), ${eur(decision.totalExclVat)} excl. VAT for ${decision.pricingDate}; policy: ${decision.outcome}.`,
        details: { source, outcome: decision.outcome, reasons: decision.reasons, totalExclVat: decision.totalExclVat },
      },
    ]);
    return (await withRelations(tx, [created]))[0]!;
  });
}

export async function listProposals(actor: Actor, query: ListProposalsQuery): Promise<Proposal[]> {
  await expireStaleApprovals(actor);
  const d = await db();
  const where: SQL[] = [eq(proposal.organizationId, actor.organizationId)];
  if (query.status) where.push(eq(proposal.status, query.status));
  if (query.mine === "true") where.push(eq(proposal.createdBy, actor.userId));
  const rows = await d.select().from(proposal).where(and(...where)).orderBy(desc(proposal.createdAt)).limit(200);
  return withRelations(d, rows);
}

export async function getProposal(actor: Actor, id: string): Promise<Proposal> {
  await expireStaleApprovals(actor);
  const d = await db();
  const [row] = await d
    .select()
    .from(proposal)
    .where(and(eq(proposal.id, id), eq(proposal.organizationId, actor.organizationId)));
  if (!row) throw notFound("Proposal");
  return (await withRelations(d, [row]))[0]!;
}

function requireCreator(row: ProposalRow, actor: Actor) {
  if (row.createdBy !== actor.userId)
    throw new PurchasingError(403, "NOT_CREATOR", "Only the buyer who created this proposal can do this.");
}

async function cancelLocked(tx: Tx, actor: Actor, row: ProposalRow, why: string) {
  enforce(canCancel(row.status as ProposalStatus));
  await setProposalStatus(tx, row.id, "CANCELLED");
  await tx
    .update(approval)
    .set({ status: "CANCELLED" })
    .where(and(eq(approval.proposalId, row.id), eq(approval.status, "PENDING")));
  await recordAudit(tx, actor, { action: "proposal.cancelled", resourceType: "proposal", resourceId: row.id, summary: why });
}

export async function cancelProposal(actor: Actor, id: string): Promise<Proposal> {
  return (await db()).transaction(async (tx) => {
    const row = await lockProposal(tx, actor.organizationId, id);
    requireCreator(row, actor);
    await cancelLocked(tx, actor, row, "Cancelled the proposal.");
    return reload(tx, row.id);
  });
}

/**
 * Proposals never change: a revision creates a new proposal from the changed lines (priced and
 * checked again) and cancels the old one unless the revised proposal is BLOCKED by policy
 * (keeping the old proposal active so a buyer never loses a valid READY proposal).
 * Only the creator may revise, and only while it can still be cancelled.
 */
export async function reviseProposal(
  actor: Actor,
  id: string,
  next: {
    lines: { productId: string; quantity: number; substituteFor?: { requested: string; reason: "split" | "swap" | "fallback" } | null }[];
    date?: string;
    appliedChanges: string[];
    selection?: ProposalSelection | null;
  },
): Promise<ReviseProposalResponse> {
  const old = await getProposal(actor, id);
  if (old.createdBy !== actor.userId)
    throw new PurchasingError(403, "NOT_CREATOR", "Only the buyer who created this proposal can revise it.");
  enforce(canCancel(old.status));
  if (!next.lines.length) throw new PurchasingError(400, "EMPTY_PROPOSAL", "The revision removes every line; cancel the proposal instead.");

  const baseSelection = next.selection !== undefined ? next.selection : old.selection;
  const story = old.source === "recipe" ? "recipe_order" : "simple_buy";
  const revised = await createProposal(
    actor,
    {
      lines: next.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, ...(l.substituteFor ? { substituteFor: l.substituteFor } : {}) })),
      date: next.date ?? old.pricingDate,
      note: old.note ?? undefined,
    },
    {
      source: old.source ?? "buyer",
      selection: baseSelection,
      // The story's later steps (budget, order, approval or change, checkout) now describe this revision.
      onPriced: baseSelection?.steps
        ? (priced) => ({
            selection: {
              ...baseSelection,
              steps: withPricingSteps(story, baseSelection.steps!, priced, [
                ...revisionsOf(baseSelection.steps),
                { previousProposalId: old.id, appliedChanges: next.appliedChanges },
              ]),
            },
          })
        : undefined,
      preparation: [
        {
          action: "proposal.revised",
          summary: `Revision of proposal ${old.id}: ${next.appliedChanges.join("; ") || "re-priced"}.`,
          details: { previousProposalId: old.id, appliedChanges: next.appliedChanges },
        },
      ],
    },
  );
  // A BLOCKED revision doesn't replace a usable proposal: the old one stays as it was.
  const previousCancelled = revised.status !== "BLOCKED";
  if (previousCancelled) {
    await (await db()).transaction(async (tx) => {
      const row = await lockProposal(tx, actor.organizationId, old.id);
      await cancelLocked(tx, actor, row, `Replaced by revised proposal ${revised.id}.`);
    });
  }
  return { previousProposalId: old.id, previousCancelled, appliedChanges: next.appliedChanges, proposal: revised };
}

// ---------- Approvals ----------

export async function requestApproval(actor: Actor, id: string): Promise<Proposal> {
  return (await db()).transaction(async (tx) => {
    const row = await lockProposal(tx, actor.organizationId, id);
    requireCreator(row, actor);
    if (row.status === "PENDING_APPROVAL") return reload(tx, row.id); // already requested: same approval
    enforce(canRequestApproval(row.status as ProposalStatus, row.outcome as PolicyOutcome));
    enforce(checkQuote(row.quoteExpiresAt, new Date()));
    const [created] = await tx
      .insert(approval)
      .values({
        proposalId: row.id,
        organizationId: actor.organizationId,
        proposalHash: row.hash,
        status: "PENDING",
        requestedBy: actor.userId,
        // Approval only makes sense while the frozen prices hold.
        expiresAt: row.quoteExpiresAt,
      })
      .returning({ id: approval.id });
    await setProposalStatus(tx, row.id, "PENDING_APPROVAL");
    const reasons = (row.decision.reasons ?? []).filter((r) => r.outcome !== "ALLOW").map((r) => r.message);
    await recordAudit(tx, actor, {
      action: "approval.requested",
      resourceType: "proposal",
      resourceId: row.id,
      summary: `Sent for approval (${eur(row.totalExclVat)}): ${reasons.join(" ") || "approval required"}`,
      details: { approvalId: created!.id, proposalHash: row.hash },
    });
    return reload(tx, row.id);
  });
}

export async function listApprovals(actor: Actor, query: ListApprovalsQuery): Promise<ApprovalWithProposal[]> {
  await expireStaleApprovals(actor);
  const d = await db();
  const where: SQL[] = [eq(approval.organizationId, actor.organizationId)];
  if (query.status) where.push(eq(approval.status, query.status));
  const approvals = await d.select().from(approval).where(and(...where)).orderBy(desc(approval.requestedAt)).limit(200);
  if (!approvals.length) return [];
  const rows = await d.select().from(proposal).where(inArray(proposal.id, approvals.map((a) => a.proposalId)));
  const proposals = new Map((await withRelations(d, rows)).map((p) => [p.id, p]));
  const quoteExpiry = new Map(rows.map((r) => [r.id, r.quoteExpiresAt]));
  const names = await usernames(d, approvals.flatMap((a) => [a.requestedBy, a.decidedBy]));
  return approvals.map((a) => ({
    ...toApproval(a, names, quoteExpiry.get(a.proposalId) ?? null),
    proposal: proposals.get(a.proposalId)!,
  }));
}

/** For a badge: approvals waiting for a decision (expired ones are expired first) and the next expiry. */
export async function pendingApprovalCount(actor: Actor): Promise<PendingApprovalCount> {
  await expireStaleApprovals(actor);
  const expiry = sql<Date | null>`min(coalesce(${approval.expiresAt}, ${proposal.quoteExpiresAt}))`.mapWith((v) =>
    v === null ? null : new Date(v as string),
  );
  const [row] = await (await db())
    .select({ count: sql<number>`count(*)`.mapWith(Number), nextExpiresAt: expiry })
    .from(approval)
    .innerJoin(proposal, eq(proposal.id, approval.proposalId))
    .where(and(eq(approval.organizationId, actor.organizationId), eq(approval.status, "PENDING")));
  return { count: row?.count ?? 0, nextExpiresAt: row?.nextExpiresAt?.toISOString() ?? null };
}

/**
 * Lazy expiry (no background job): the organization's pending approvals whose time is up become
 * EXPIRED, with their PENDING_APPROVAL proposals, and the audit log says so. Rows another request
 * holds are skipped and expire on the next call.
 */
async function expireStaleApprovals(actor: Actor): Promise<void> {
  const d = await db();
  const due = and(
    eq(approval.organizationId, actor.organizationId),
    eq(approval.status, "PENDING"),
    sql`coalesce(${approval.expiresAt}, ${proposal.quoteExpiresAt}) <= now()`,
  );
  const [any] = await d
    .select({ id: approval.id })
    .from(approval)
    .innerJoin(proposal, eq(proposal.id, approval.proposalId))
    .where(due)
    .limit(1);
  if (!any) return;
  await d.transaction(async (tx) => {
    const stale = await tx
      .select({ id: approval.id, proposalId: approval.proposalId, totalExclVat: proposal.totalExclVat })
      .from(approval)
      .innerJoin(proposal, eq(proposal.id, approval.proposalId))
      .where(due)
      .orderBy(asc(approval.requestedAt))
      .for("update", { skipLocked: true });
    if (!stale.length) return;
    const now = new Date();
    await tx.update(approval).set({ status: "EXPIRED" }).where(inArray(approval.id, stale.map((s) => s.id)));
    await tx
      .update(proposal)
      .set({ status: "EXPIRED", updatedAt: now })
      .where(and(inArray(proposal.id, stale.map((s) => s.proposalId)), eq(proposal.status, "PENDING_APPROVAL")));
    await recordAudit(
      tx,
      actor,
      stale.map((s) => ({
        action: "approval.expired",
        resourceType: "proposal" as const,
        resourceId: s.proposalId,
        actorType: "system" as const,
        summary: `The approval request (${eur(s.totalExclVat)}) expired undecided with the proposal's prices; create a new proposal.`,
        details: { approvalId: s.id },
      })),
    );
  });
}

export async function decideApproval(actor: Actor, id: string, request: DecideApprovalRequest): Promise<Proposal> {
  await expireStaleApprovals(actor);
  return (await db()).transaction(async (tx) => {
    const [found] = await tx
      .select({ proposalId: approval.proposalId })
      .from(approval)
      .where(and(eq(approval.id, id), eq(approval.organizationId, actor.organizationId)));
    if (!found) throw notFound("Approval");
    const row = await lockProposal(tx, actor.organizationId, found.proposalId);
    const [current] = await tx.select().from(approval).where(eq(approval.id, id));
    enforce(
      canDecide(current!.status as ApprovalStatus, row.status as ProposalStatus, request.proposalHash, row.hash, {
        expiresAt: approvalExpiry(current!.expiresAt, row.quoteExpiresAt),
        now: new Date(),
      }),
    );
    enforce(checkQuote(row.quoteExpiresAt, new Date()));
    await tx
      .update(approval)
      .set({ status: request.decision, decidedBy: actor.userId, decidedAt: new Date(), comment: request.comment || null })
      .where(eq(approval.id, id));
    await setProposalStatus(tx, row.id, request.decision);
    await recordAudit(tx, actor, {
      action: "approval.decided",
      resourceType: "proposal",
      resourceId: row.id,
      summary: `${request.decision === "APPROVED" ? "Approved" : "Rejected"} the proposal (${eur(row.totalExclVat)})${request.comment ? `: ${request.comment}` : "."}`,
      details: { approvalId: id, decision: request.decision, comment: request.comment ?? null, proposalHash: row.hash },
    });
    return reload(tx, row.id);
  });
}

// ---------- Orders ----------

export type PlacedOrder = { order: Order; replayed: boolean };

async function orderByKey(d: Db, actor: Actor, key: string, proposalId: string): Promise<PlacedOrder | null> {
  const [existing] = await d
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, actor.organizationId), eq(purchaseOrder.idempotencyKey, key)));
  if (!existing) return null;
  if (existing.proposalId !== proposalId)
    throw new PurchasingError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for another proposal.");
  return { order: (await ordersWithNames(d, [existing]))[0]!, replayed: true };
}

/** Current Valio prices and availability for frozen lines (network: call outside transactions). */
async function liveOffer(lines: readonly StoredProposalLine[], date: string): Promise<LiveLineCheck[]> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const [prices, availability] = await Promise.all([getPrices({ productIds, date }), getAvailability({ productIds, date })]);
  const priceBy = new Map(prices.quotes.map((q) => [q.productId, q]));
  const availabilityBy = new Map(availability.items.map((a) => [a.productId, a]));
  return productIds.map((productId) => {
    const quote = priceBy.get(productId);
    const avail = availabilityBy.get(productId);
    return {
      productId,
      unitPriceExclVat: quote?.found ? quote.priceExclVat : null,
      orderable: avail?.orderable ?? null,
      salesBlock: avail?.salesBlock ?? null,
    };
  });
}

const ORDERABLE: readonly string[] = ["READY", "APPROVED"];

/**
 * Orders a proposal: state + approval checks, quote expiry, and a re-check that Valio's prices
 * (5-minute cache) and availability still match the frozen ones. A replay of the same key returns
 * the existing order without any check.
 */
export async function placeOrder(actor: Actor, proposalId: string, idempotencyKey: string): Promise<PlacedOrder> {
  const d = await db();
  const replay = await orderByKey(d, actor, idempotencyKey, proposalId);
  if (replay) return replay;
  const [pre] = await d
    .select({ status: proposal.status, lines: proposal.lines, pricingDate: proposal.pricingDate })
    .from(proposal)
    .where(and(eq(proposal.id, proposalId), eq(proposal.organizationId, actor.organizationId)));
  if (!pre) throw notFound("Proposal");
  // Only ask Valio when the order could go through; other states fail the checks below anyway.
  const live = ORDERABLE.includes(pre.status) ? await liveOffer(pre.lines, pre.pricingDate) : [];

  try {
    return await d.transaction(async (tx) => {
      const row = await lockProposal(tx, actor.organizationId, proposalId);
      const replayed = await orderByKey(tx, actor, idempotencyKey, proposalId);
      if (replayed) return replayed;
      const [approvalRow] = await tx.select().from(approval).where(eq(approval.proposalId, row.id));
      enforce(
        canOrder(
          row.status as ProposalStatus,
          row.outcome as PolicyOutcome,
          approvalRow ? { status: approvalRow.status as ApprovalStatus, proposalHash: approvalRow.proposalHash } : null,
          row.hash,
        ),
      );
      enforce(checkQuote(row.quoteExpiresAt, new Date()));
      const liveCheck = checkLiveOffer(row.lines, live);
      if (!liveCheck.ok) {
        // A refused order is part of the record too (outside the rolled-back transaction).
        await recordAudit(d, actor, {
          action: "order.refused",
          resourceType: "proposal",
          resourceId: row.id,
          summary: liveCheck.message,
          details: { code: liveCheck.code },
        });
      }
      enforce(liveCheck);
      const [order] = await tx
        .insert(purchaseOrder)
        .values({
          proposalId: row.id,
          organizationId: actor.organizationId,
          createdBy: actor.userId,
          idempotencyKey,
          proposalHash: row.hash,
          lines: row.lines,
          totalExclVat: row.totalExclVat,
          currency: row.currency,
        })
        .returning();
      await setProposalStatus(tx, row.id, "ORDERED");
      await recordAudit(tx, actor, {
        action: "order.placed",
        resourceType: "proposal",
        resourceId: row.id,
        summary: `Placed simulated order ${order!.id} (${eur(row.totalExclVat)}); prices re-checked against Valio.`,
        details: { orderId: order!.id, idempotencyKey, proposalHash: row.hash },
      });
      return { order: (await ordersWithNames(tx, [order!]))[0]!, replayed: false };
    });
  } catch (err) {
    // The same key raced on another proposal (unique violation): answer like a replay would.
    if ((err as { cause?: { code?: string } }).cause?.code === "23505" || (err as { code?: string }).code === "23505") {
      const again = await orderByKey(d, actor, idempotencyKey, proposalId);
      if (again) return again;
    }
    throw err;
  }
}

export async function listOrders(actor: Actor): Promise<Order[]> {
  const d = await db();
  const rows = await d
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.organizationId, actor.organizationId))
    .orderBy(desc(purchaseOrder.createdAt))
    .limit(200);
  return ordersWithNames(d, rows);
}

export async function getOrder(actor: Actor, id: string): Promise<Order> {
  const d = await db();
  const [row] = await d
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, actor.organizationId)));
  if (!row) throw notFound("Order");
  return (await ordersWithNames(d, [row]))[0]!;
}

/** Itemized receipt of a simulated order: who ordered, who approved, what at which price. */
export async function getOrderReceipt(actor: Actor, id: string): Promise<OrderReceipt> {
  const d = await db();
  const [row] = await d
    .select({
      order: purchaseOrder,
      pricingDate: proposal.pricingDate,
      signature: proposal.signature,
      signatureKeyId: proposal.signatureKeyId,
      orgName: organization.name,
    })
    .from(purchaseOrder)
    .innerJoin(proposal, eq(proposal.id, purchaseOrder.proposalId))
    .innerJoin(organization, eq(organization.id, purchaseOrder.organizationId))
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, actor.organizationId)));
  if (!row) throw notFound("Order");
  const [approvalRow] = await d.select().from(approval).where(eq(approval.proposalId, row.order.proposalId));
  const names = await usernames(d, [row.order.createdBy, approvalRow?.decidedBy ?? null]);
  return {
    orderId: row.order.id,
    proposalId: row.order.proposalId,
    issuedAt: row.order.createdAt.toISOString(),
    organizationName: row.orgName,
    orderedByName: names.get(row.order.createdBy) ?? null,
    approvedByName: approvalRow?.status === "APPROVED" && approvalRow.decidedBy ? (names.get(approvalRow.decidedBy) ?? null) : null,
    deliveryDate: row.pricingDate,
    lines: row.order.lines.map(withAvailability),
    totalExclVat: row.order.totalExclVat,
    currency: row.order.currency,
    status: "SIMULATED_CONFIRMED",
    source: "LOCAL_SIMULATOR",
    proposalHash: row.order.proposalHash,
    proposalSignature: row.signature,
    signatureKeyId: row.signatureKeyId,
  };
}

/**
 * Trust check an agent or a person can run without a manual lookup: the stored content still
 * hashes to the stored hash, the server's signature over id + hash holds, and every frozen price is
 * the price in the recorded Valio answer it names (snapshot id; older proposals: any snapshot with
 * that price for the date).
 */
export async function verifyProposal(actor: Actor, id: string): Promise<ProposalVerification> {
  const d = await db();
  const [row] = await d
    .select()
    .from(proposal)
    .where(and(eq(proposal.id, id), eq(proposal.organizationId, actor.organizationId)));
  if (!row) throw notFound("Proposal");
  const frozen = {
    lines: row.lines,
    totalExclVat: row.totalExclVat,
    currency: row.currency,
    pricingDate: row.pricingDate,
    priceSource: row.priceSource,
    decision: row.decision,
  };
  const recomputed = contentHash(row.quoteExpiresAt ? { ...frozen, quoteExpiresAt: row.quoteExpiresAt.toISOString() } : frozen);
  const ids = [...new Set(row.lines.map((l) => l.productId))];
  const snapshots = ids.length
    ? await d
        .select()
        .from(valioPriceSnapshot)
        .where(and(inArray(valioPriceSnapshot.productId, ids), eq(valioPriceSnapshot.pricingDate, row.pricingDate)))
        .orderBy(desc(valioPriceSnapshot.fetchedAt))
    : [];
  return {
    proposalId: row.id,
    storedHash: row.hash,
    recomputedHash: recomputed,
    hashValid: recomputed === row.hash,
    // The signature covers the stored hash; a changed hash already shows in hashValid.
    signatureValid: checkProposalSignature({ proposalId: row.id, hash: row.hash }, row.signature, row.signatureKeyId),
    signatureKeyId: row.signatureKeyId,
    lines: row.lines.map((line) => {
      const samePrice = (s: (typeof snapshots)[number]) =>
        s.productId === line.productId && line.unitPriceExclVat !== null && s.priceExclVat === line.unitPriceExclVat;
      const match = line.priceSnapshotId
        ? snapshots.find((s) => String(s.id) === line.priceSnapshotId && samePrice(s))
        : snapshots.find(samePrice);
      return {
        productId: line.productId,
        unitPriceExclVat: line.unitPriceExclVat,
        priceSnapshotId: match ? String(match.id) : (line.priceSnapshotId ?? null),
        availabilitySnapshotId: line.availabilitySnapshotId ?? null,
        snapshotFound: !!match,
        snapshotFetchedAt: match?.fetchedAt.toISOString() ?? null,
        source: (match?.source as ProposalVerification["lines"][number]["source"]) ?? null,
      };
    }),
    verifiedAt: new Date().toISOString(),
  };
}
