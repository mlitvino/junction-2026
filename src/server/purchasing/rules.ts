import "server-only";

import { createHash } from "node:crypto";

import type { PolicyOutcome } from "@/shared/contracts/policy";
import type { ApprovalStatus, ProposalStatus } from "@/shared/contracts/purchasing";

// The purchasing flow's rules, as pure functions (no database). Type-only imports, so
// `pnpm test:server` (plain Node) can run them. The service (server/services/purchasing.ts)
// applies them inside transactions.

/** SHA-256 of a value as canonical JSON (object keys sorted), so equal content = equal hash. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A new proposal's status from its policy outcome. */
export function initialStatus(outcome: PolicyOutcome): ProposalStatus {
  return outcome === "DENY" ? "BLOCKED" : "READY";
}

export type RuleResult = { ok: true } | { ok: false; status: 409 | 422; code: string; message: string };
const ok: RuleResult = { ok: true };
const no = (status: 409 | 422, code: string, message: string): RuleResult => ({ ok: false, status, code, message });

/** Can the buyer send this proposal to an approver? (An existing pending approval is handled by the caller.) */
export function canRequestApproval(status: ProposalStatus, outcome: PolicyOutcome): RuleResult {
  if (outcome === "ALLOW") return no(422, "APPROVAL_NOT_NEEDED", "This proposal is allowed without approval.");
  if (outcome === "DENY") return no(422, "BLOCKED_BY_POLICY", "The policy blocks this proposal.");
  if (status !== "READY") return no(409, "INVALID_STATE", `A ${status} proposal can't be sent for approval.`);
  return ok;
}

/** Can an approver decide this approval? `expiry` = the approval's expiry and the current time. */
export function canDecide(
  approvalStatus: ApprovalStatus,
  proposalStatus: ProposalStatus,
  reviewedHash: string,
  proposalHash: string,
  expiry?: { expiresAt: Date | null; now: Date },
): RuleResult {
  const expired = no(409, "APPROVAL_EXPIRED", "This approval expired with the proposal's prices. The buyer must create a new proposal.");
  if (approvalStatus === "EXPIRED") return expired;
  if (approvalStatus !== "PENDING" || proposalStatus !== "PENDING_APPROVAL")
    return no(409, "INVALID_STATE", `This approval is already ${approvalStatus}.`);
  if (expiry && approvalExpired(approvalStatus, expiry.expiresAt, expiry.now)) return expired;
  if (reviewedHash !== proposalHash)
    return no(409, "HASH_MISMATCH", "The proposal you reviewed is not the current one. Review it again.");
  return ok;
}

/** Can an order be placed for this proposal? */
export function canOrder(
  status: ProposalStatus,
  outcome: PolicyOutcome,
  approval: { status: ApprovalStatus; proposalHash: string } | null,
  proposalHash: string,
): RuleResult {
  if (outcome === "DENY") return no(422, "BLOCKED_BY_POLICY", "The policy blocks this proposal.");
  if (outcome === "REQUIRE_APPROVAL") {
    if (status === "READY" || status === "PENDING_APPROVAL")
      return no(422, "APPROVAL_REQUIRED", "This proposal needs an approver's decision first.");
    if (status !== "APPROVED" || approval?.status !== "APPROVED" || approval.proposalHash !== proposalHash)
      return no(409, "INVALID_STATE", `A ${status} proposal can't be ordered.`);
    return ok;
  }
  if (status !== "READY") return no(409, "INVALID_STATE", `A ${status} proposal can't be ordered.`);
  return ok;
}

const CANCELLABLE: readonly ProposalStatus[] = ["READY", "PENDING_APPROVAL", "APPROVED"];

export function canCancel(status: ProposalStatus): RuleResult {
  return CANCELLABLE.includes(status) ? ok : no(409, "INVALID_STATE", `A ${status} proposal can't be cancelled.`);
}

// ---------- Approval expiry ----------

/** When a pending approval expires: its own expiry, else (rows from before it existed) the quote's. */
export function approvalExpiry(approvalExpiresAt: Date | null, quoteExpiresAt: Date | null): Date | null {
  return approvalExpiresAt ?? quoteExpiresAt;
}

/** A pending approval past its expiry can't be decided any more and becomes EXPIRED. */
export function approvalExpired(status: ApprovalStatus, expiresAt: Date | null, now: Date): boolean {
  return status === "PENDING" && expiresAt !== null && now.getTime() >= expiresAt.getTime();
}

// ---------- Fixed prices ----------

/** How long a proposal's frozen prices can be approved and ordered. */
export const QUOTE_TTL_HOURS = 24;

export function quoteExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + QUOTE_TTL_HOURS * 3_600_000);
}

/** Expired quotes can't be sent, approved or ordered. Null (proposals from before expiry existed): never expires. */
export function checkQuote(expiresAt: Date | null, now: Date): RuleResult {
  if (expiresAt && now.getTime() >= expiresAt.getTime())
    return no(409, "QUOTE_EXPIRED", "The prices in this proposal have expired. Create a new proposal.");
  return ok;
}

export type LiveLineCheck = {
  productId: string;
  /** Current EUR excl. VAT per sales unit; null when Valio has no price now. */
  unitPriceExclVat: number | null;
  /** Current availability; null when Valio gave no answer. */
  orderable: boolean | null;
  salesBlock: boolean | null;
};

/**
 * Order-time re-check: the frozen prices must still be Valio's prices, and nothing may have become
 * sales-blocked or undeliverable. Lines missing from `current` count as changed.
 */
export function checkLiveOffer(
  frozen: readonly { productId: string; unitPriceExclVat: number | null }[],
  current: readonly LiveLineCheck[],
): RuleResult {
  const now = new Map(current.map((c) => [c.productId, c]));
  const priceChanged = frozen
    .filter((line) => {
      const c = now.get(line.productId);
      return !c || c.unitPriceExclVat === null || c.unitPriceExclVat !== line.unitPriceExclVat;
    })
    .map((line) => line.productId);
  if (priceChanged.length)
    return no(
      409,
      "PRICE_CHANGED",
      `The price of ${[...new Set(priceChanged)].join(", ")} has changed since the proposal. Create a new proposal.`,
    );
  const unavailable = frozen
    .filter((line) => {
      const c = now.get(line.productId);
      return !!c && (c.salesBlock === true || c.orderable === false);
    })
    .map((line) => line.productId);
  if (unavailable.length)
    return no(
      409,
      "AVAILABILITY_CHANGED",
      `${[...new Set(unavailable)].join(", ")} can no longer be delivered. Create a new proposal.`,
    );
  return ok;
}
