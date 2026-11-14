import "server-only";

import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import {
  approval,
  proposal,
  purchaseOrder,
  valioProduct,
  type ApprovalRow,
  type ProposalRow,
  type PurchaseOrderRow,
  type StoredDecision,
  type StoredProposalLine,
} from "@/server/db/schema";
import {
  canCancel,
  canDecide,
  canOrder,
  canRequestApproval,
  contentHash,
  initialStatus,
  type RuleResult,
} from "@/server/purchasing/rules";
import type {
  Approval,
  ApprovalStatus,
  ApprovalWithProposal,
  CreateProposalRequest,
  DecideApprovalRequest,
  ListApprovalsQuery,
  ListProposalsQuery,
  Order,
  Proposal,
  ProposalStatus,
} from "@/shared/contracts/purchasing";
import type { PolicyOutcome } from "@/shared/contracts/policy";

import { evaluateDraft } from "./policy";

// Purchasing flow: proposals, approvals, orders. Every function takes the caller's organization
// (and user) and only touches that organization's rows. Rules: server/purchasing/rules.ts.
// State changes lock the proposal row (SELECT … FOR UPDATE), so concurrent clicks can't both win.

/** Expected failures, mapped to HTTP statuses by the routes. */
export class PurchasingError extends Error {
  readonly status: 403 | 404 | 409 | 422;
  readonly code: string;
  constructor(status: 403 | 404 | 409 | 422, code: string, message: string) {
    super(message);
    this.name = "PurchasingError";
    this.status = status;
    this.code = code;
  }
}

type Actor = { organizationId: string; userId: string };
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function db() {
  await ensureDatabase();
  return getDb();
}

function enforce(result: RuleResult) {
  if (!result.ok) throw new PurchasingError(result.status, result.code, result.message);
}

const notFound = (what: string) => new PurchasingError(404, "NOT_FOUND", `${what} not found`);

// ---------- Mapping ----------

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    proposalId: row.proposalId,
    proposalHash: row.proposalHash,
    status: row.status as ApprovalStatus,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    comment: row.comment,
  };
}

function toProposal(row: ProposalRow, approvalRow: ApprovalRow | null, orderId: string | null): Proposal {
  return {
    id: row.id,
    status: row.status as ProposalStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines,
    totalExclVat: row.totalExclVat,
    currency: row.currency,
    pricingDate: row.pricingDate,
    priceSource: row.priceSource as Proposal["priceSource"],
    decision: row.decision as Proposal["decision"],
    hash: row.hash,
    note: row.note,
    approval: approvalRow ? toApproval(approvalRow) : null,
    orderId,
  };
}

function toOrder(row: PurchaseOrderRow): Order {
  return {
    id: row.id,
    proposalId: row.proposalId,
    status: "SIMULATED_CONFIRMED",
    source: "LOCAL_SIMULATOR",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    idempotencyKey: row.idempotencyKey,
    proposalHash: row.proposalHash,
    lines: row.lines,
    totalExclVat: row.totalExclVat,
    currency: row.currency,
  };
}

/** Proposals with their approval and order id, in the given order. */
async function withRelations(d: Tx | ReturnType<typeof getDb>, rows: ProposalRow[]): Promise<Proposal[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [approvals, orders] = await Promise.all([
    d.select().from(approval).where(inArray(approval.proposalId, ids)),
    d
      .select({ id: purchaseOrder.id, proposalId: purchaseOrder.proposalId })
      .from(purchaseOrder)
      .where(inArray(purchaseOrder.proposalId, ids)),
  ]);
  const approvalBy = new Map(approvals.map((a) => [a.proposalId, a]));
  const orderBy = new Map(orders.map((o) => [o.proposalId, o.id]));
  return rows.map((r) => toProposal(r, approvalBy.get(r.id) ?? null, orderBy.get(r.id) ?? null));
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

async function reload(tx: Tx, row: ProposalRow): Promise<Proposal> {
  const [fresh] = await tx.select().from(proposal).where(eq(proposal.id, row.id));
  return (await withRelations(tx, [fresh!]))[0]!;
}

// ---------- Proposals ----------

export async function createProposal(actor: Actor, request: CreateProposalRequest): Promise<Proposal> {
  const decision = await evaluateDraft(actor.organizationId, request);
  const d = await db();
  const ids = [...new Set(request.lines.map((l) => l.productId))];
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

  const [row] = await d
    .insert(proposal)
    .values({
      organizationId: actor.organizationId,
      createdBy: actor.userId,
      status: initialStatus(decision.outcome),
      outcome: decision.outcome,
      hash: contentHash(frozen),
      note: request.note || null,
      ...frozen,
    })
    .returning();
  return toProposal(row!, null, null);
}

export async function listProposals(actor: Actor, query: ListProposalsQuery): Promise<Proposal[]> {
  const d = await db();
  const where: SQL[] = [eq(proposal.organizationId, actor.organizationId)];
  if (query.status) where.push(eq(proposal.status, query.status));
  if (query.mine === "true") where.push(eq(proposal.createdBy, actor.userId));
  const rows = await d
    .select()
    .from(proposal)
    .where(and(...where))
    .orderBy(desc(proposal.createdAt))
    .limit(200);
  return withRelations(d, rows);
}

export async function getProposal(actor: Actor, id: string): Promise<Proposal> {
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

export async function cancelProposal(actor: Actor, id: string): Promise<Proposal> {
  return (await db()).transaction(async (tx) => {
    const row = await lockProposal(tx, actor.organizationId, id);
    requireCreator(row, actor);
    enforce(canCancel(row.status as ProposalStatus));
    await setProposalStatus(tx, row.id, "CANCELLED");
    await tx
      .update(approval)
      .set({ status: "CANCELLED" })
      .where(and(eq(approval.proposalId, row.id), eq(approval.status, "PENDING")));
    return reload(tx, row);
  });
}

// ---------- Approvals ----------

export async function requestApproval(actor: Actor, id: string): Promise<Proposal> {
  return (await db()).transaction(async (tx) => {
    const row = await lockProposal(tx, actor.organizationId, id);
    requireCreator(row, actor);
    if (row.status === "PENDING_APPROVAL") return reload(tx, row); // already requested: same approval
    enforce(canRequestApproval(row.status as ProposalStatus, row.outcome as PolicyOutcome));
    await tx.insert(approval).values({
      proposalId: row.id,
      organizationId: actor.organizationId,
      proposalHash: row.hash,
      status: "PENDING",
      requestedBy: actor.userId,
    });
    await setProposalStatus(tx, row.id, "PENDING_APPROVAL");
    return reload(tx, row);
  });
}

export async function listApprovals(actor: Actor, query: ListApprovalsQuery): Promise<ApprovalWithProposal[]> {
  const d = await db();
  const where: SQL[] = [eq(approval.organizationId, actor.organizationId)];
  if (query.status) where.push(eq(approval.status, query.status));
  const approvals = await d
    .select()
    .from(approval)
    .where(and(...where))
    .orderBy(desc(approval.requestedAt))
    .limit(200);
  if (!approvals.length) return [];
  const rows = await d
    .select()
    .from(proposal)
    .where(inArray(proposal.id, approvals.map((a) => a.proposalId)));
  const proposals = new Map((await withRelations(d, rows)).map((p) => [p.id, p]));
  return approvals.map((a) => ({ ...toApproval(a), proposal: proposals.get(a.proposalId)! }));
}

export async function decideApproval(actor: Actor, id: string, request: DecideApprovalRequest): Promise<Proposal> {
  return (await db()).transaction(async (tx) => {
    const [found] = await tx
      .select({ proposalId: approval.proposalId })
      .from(approval)
      .where(and(eq(approval.id, id), eq(approval.organizationId, actor.organizationId)));
    if (!found) throw notFound("Approval");
    const row = await lockProposal(tx, actor.organizationId, found.proposalId);
    const [current] = await tx.select().from(approval).where(eq(approval.id, id));
    enforce(
      canDecide(current!.status as ApprovalStatus, row.status as ProposalStatus, request.proposalHash, row.hash),
    );
    await tx
      .update(approval)
      .set({
        status: request.decision,
        decidedBy: actor.userId,
        decidedAt: new Date(),
        comment: request.comment || null,
      })
      .where(eq(approval.id, id));
    await setProposalStatus(tx, row.id, request.decision);
    return reload(tx, row);
  });
}

// ---------- Orders ----------

export type PlacedOrder = { order: Order; replayed: boolean };

async function orderByKey(tx: Tx, actor: Actor, key: string, proposalId: string): Promise<PlacedOrder | null> {
  const [existing] = await tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, actor.organizationId), eq(purchaseOrder.idempotencyKey, key)));
  if (!existing) return null;
  if (existing.proposalId !== proposalId)
    throw new PurchasingError(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for another proposal.");
  return { order: toOrder(existing), replayed: true };
}

export async function placeOrder(actor: Actor, proposalId: string, idempotencyKey: string): Promise<PlacedOrder> {
  const d = await db();
  try {
    return await d.transaction(async (tx) => {
      const row = await lockProposal(tx, actor.organizationId, proposalId);
      const replay = await orderByKey(tx, actor, idempotencyKey, proposalId);
      if (replay) return replay;
      const [approvalRow] = await tx.select().from(approval).where(eq(approval.proposalId, row.id));
      enforce(
        canOrder(
          row.status as ProposalStatus,
          row.outcome as PolicyOutcome,
          approvalRow ? { status: approvalRow.status as ApprovalStatus, proposalHash: approvalRow.proposalHash } : null,
          row.hash,
        ),
      );
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
      return { order: toOrder(order!), replayed: false };
    });
  } catch (err) {
    // The same key raced on another proposal (unique violation): answer like a replay would.
    if ((err as { cause?: { code?: string } }).cause?.code === "23505" || (err as { code?: string }).code === "23505") {
      const replay = await d.transaction((tx) => orderByKey(tx, actor, idempotencyKey, proposalId));
      if (replay) return replay;
    }
    throw err;
  }
}

export async function listOrders(actor: Actor): Promise<Order[]> {
  const rows = await (await db())
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.organizationId, actor.organizationId))
    .orderBy(desc(purchaseOrder.createdAt))
    .limit(200);
  return rows.map(toOrder);
}

export async function getOrder(actor: Actor, id: string): Promise<Order> {
  const [row] = await (await db())
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, actor.organizationId)));
  if (!row) throw notFound("Order");
  return toOrder(row);
}
