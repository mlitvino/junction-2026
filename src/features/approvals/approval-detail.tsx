"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { apiClient } from "@/client/api-client";
import { simulatorAvailable, useProcurement } from "@/client/use-procurement";
import { useViewer } from "@/client/use-viewer";
import { viewerHasRole } from "@/client/viewer";
import { PageHeader } from "@/components/layout/page-header";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { buttonVariants } from "@/components/ui/button";
import { ProposalContent } from "@/features/procurement/proposal-view";
import { ApprovalStatus } from "@/features/procurement/status";
import { ActivityTimeline } from "@/features/procurement/activity-timeline";
import { DemoStorageNotice, EmptyState, IntegrationState } from "@/features/procurement/states";

export function ApprovalDetail({ id }: { id: string }) {
  const snapshot = useProcurement();
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const viewer = useViewer();
  const demoIdentity = viewer.status === "ready" && viewer.viewer.demo;
  if (!simulatorAvailable(snapshot)) return <IntegrationState snapshot={snapshot} />;
  const approval = snapshot.state.approvals.find((a) => a.id === id);
  const proposal = snapshot.state.proposals.find((p) => p.id === approval?.proposalId);
  if (!approval || !proposal)
    return (
      <EmptyState
        page
        title="Approval not found in this demo"
        description="The local session may have been reset. This request is not available in this tab."
        href="/approvals"
        action="Back to approvals"
      />
    );
  return (
    <div className="mx-auto w-full max-w-conversation space-y-8">
      <DemoStorageNotice notice={snapshot.storageNotice} />
      <PageHeader
        title="Review demo approval"
        description={`Prepared proposal version ${approval.proposalVersion}. Your decision applies only to this exact local snapshot.`}
      />
      <ApprovalStatus status={approval.status} />
      <ProposalContent proposal={proposal} snapshot={snapshot} />
      {approval.status === "PENDING" && (
        <section aria-label="Demo approval decision" className="space-y-4 border-t pt-6">
          <h2 className="section-title">Make a demo decision</h2>
          <p className="text-sm text-muted-foreground">
            Approving records a local simulated order for this snapshot. It does not authorize a
            real purchase or verify supplier prices or stock.
          </p>
          {viewerHasRole(viewer, "APPROVER") ? (
            <div className="flex flex-wrap items-center gap-4">
              <ActionConfirmation
                title="Approve this demo purchase?"
                description={`Approve proposal version ${approval.proposalVersion} and create one local simulated order. No order will be submitted to Valio.`}
                trigger="Approve demo purchase"
                confirmLabel="Approve and simulate order"
                onConfirm={() =>
                  apiClient.procurement.decideApproval(
                    approval.id,
                    approval.proposalHash,
                    "APPROVED",
                    "",
                  )
                }
              />
              <ActionConfirmation
                title="Reject this demo request?"
                description="This decision stops the demo purchase. A reason is required."
                trigger="Reject request"
                confirmLabel="Reject demo request"
                destructive
                onConfirm={() =>
                  apiClient.procurement.decideApproval(
                    approval.id,
                    approval.proposalHash,
                    "REJECTED",
                    reason,
                  )
                }
              >
                <label htmlFor={reasonId} className="mb-2 block text-label font-medium">
                  Reason for rejection
                </label>
                <textarea
                  id={reasonId}
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="min-h-24 w-full rounded-md border border-input bg-card p-3"
                />
              </ActionConfirmation>
            </div>
          ) : (
            <p className="rounded-lg bg-muted p-4 text-sm">
              {demoIdentity
                ? "Switch to Demo Approver in the account menu to make a decision. This role switch is only a UI simulation."
                : "Only an approver in your organization can decide this request."}
            </p>
          )}
        </section>
      )}
      {approval.note && (
        <section>
          <h2 className="text-sm font-semibold">Decision note</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{approval.note}</p>
        </section>
      )}
      {proposal.orderId && (
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/orders/${proposal.orderId}`}
        >
          Open resulting simulated order
        </Link>
      )}
      <ActivityTimeline
        items={snapshot.state.activities.filter((a) => a.traceId === proposal.traceId)}
      />
    </div>
  );
}
