"use client";

import Link from "next/link";
import { apiClient } from "@/client/api-client";
import { useProcurement } from "@/client/use-procurement";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ProvisionalProposal } from "@/client/provisional/types";
import { useAction } from "./use-action";
import { ErrorState } from "./states";
import { ApprovalStatus, OrderStatus, StatusChip } from "./status";
import { money } from "./format";

export function PurchaseProposalSummary({ proposal }: { proposal: ProvisionalProposal }) {
  const { state } = useProcurement();
  const action = useAction();
  const approval = state.approvals.find((a) => a.id === proposal.approvalId);
  const denied = proposal.policyDecision.outcome === "DENY";
  return (
    <section aria-label="Purchase proposal and authorization" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">Purchase proposal</h2>
        <span className="text-caption text-muted-foreground">
          Version {proposal.version} · Synthetic demo
        </span>
      </div>
      {proposal.orderId ? (
        <OrderStatus />
      ) : approval ? (
        <ApprovalStatus status={approval.status} />
      ) : (
        <StatusChip tone={denied ? "warning" : "neutral"}>
          {denied
            ? "Purchase blocked"
            : proposal.status === "FAILED"
              ? "Run interrupted — start a new request"
              : proposal.policyDecision.outcome === "REQUIRE_APPROVAL"
                ? "Demo approval required"
                : "Allowed by the demo policy"}
        </StatusChip>
      )}
      <p className="text-sm">
        {proposal.policyDecision.reasons.map((reason) => reason.message).join(" ")}
      </p>
      <p className="text-sm text-muted-foreground">
        Total, incl. VAT:{" "}
        <span className="font-medium tabular-nums text-foreground">
          {money(proposal.totalGross)}
        </span>
        . Prices and policy outcomes are fictional scenario values.
      </p>
      {proposal.unknownCharges.length > 0 && (
        <p className="text-warning">Unknown charges: {proposal.unknownCharges.join(", ")}</p>
      )}
      <ErrorState message={action.error} />
      <div className="flex flex-wrap gap-3">
        {proposal.status === "READY" &&
          proposal.policyDecision.outcome === "REQUIRE_APPROVAL" &&
          state.role === "BUYER" && (
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(() =>
                  apiClient.procurement.requestApproval(proposal.id, proposal.version),
                )
              }
            >
              {action.busy ? "Sending…" : "Send for demo approval"}
            </Button>
          )}
        {proposal.approvalId && (
          <Link
            href={`/approvals/${proposal.approvalId}`}
            className={buttonVariants({ variant: "outline" })}
          >
            View demo approval
          </Link>
        )}
        {proposal.orderId && (
          <Link href={`/orders/${proposal.orderId}`} className={buttonVariants()}>
            View simulated order
          </Link>
        )}
        {(denied || proposal.status === "REJECTED" || proposal.status === "FAILED") && (
          <Link href="/buyer" className={buttonVariants({ variant: "outline" })}>
            Revise request
          </Link>
        )}
      </div>
      {approval?.status === "PENDING" && (
        <p className="text-caption text-muted-foreground">
          Switch to Demo Approver in the account menu to review this request. Role switching
          simulates the UI; it is not authentication or authorization.
        </p>
      )}
      <details className="text-caption text-muted-foreground">
        <summary className="min-h-11 py-3">Proposal references</summary>
        <dl className="space-y-2 break-all">
          <div>
            <dt>Proposal</dt>
            <dd>{proposal.id}</dd>
          </div>
          <div>
            <dt>Local consistency token</dt>
            <dd>{proposal.proposalHash}</dd>
          </div>
          <div>
            <dt>Trace</dt>
            <dd>{proposal.traceId}</dd>
          </div>
        </dl>
        <p className="mt-3">
          This provisional version token is not a cryptographic signature or a security guarantee.
        </p>
      </details>
    </section>
  );
}
