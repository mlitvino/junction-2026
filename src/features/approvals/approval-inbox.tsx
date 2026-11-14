"use client";

import Link from "next/link";
import { useState } from "react";
import { simulatorAvailable, useProcurement } from "@/client/use-procurement";
import { useViewer } from "@/client/use-viewer";
import { viewerHasRole } from "@/client/viewer";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ApprovalStatus } from "@/features/procurement/status";
import { money, timestamp } from "@/features/procurement/format";
import { DemoStorageNotice, EmptyState, IntegrationState } from "@/features/procurement/states";

export function ApprovalInbox() {
  const snapshot = useProcurement();
  const [filter, setFilter] = useState<"PENDING" | "ALL">("PENDING");
  const viewer = useViewer();
  const demoIdentity = viewer.status === "ready" && viewer.viewer.demo;
  if (!simulatorAvailable(snapshot)) return <IntegrationState snapshot={snapshot} />;
  if (!viewerHasRole(viewer, "APPROVER"))
    return demoIdentity ? (
      <EmptyState
        page
        title="Demo Approver view"
        description="Switch to Demo Approver in the account menu to review requests in this tab. This is a UI simulation, not authentication or authorization."
      />
    ) : (
      <EmptyState
        page
        title="Approvers only"
        description="Your account doesn't have the approver role in your organization."
      />
    );
  const approvals = snapshot.state.approvals
    .filter((a) => filter === "ALL" || a.status === filter)
    .slice()
    .reverse();
  const pending = snapshot.state.approvals.filter((a) => a.status === "PENDING").length;
  return (
    <div className="mx-auto w-full max-w-data space-y-8">
      <PageHeader
        title="Approvals"
        description="Review the details, then make a demo decision. Nothing will be submitted to Valio."
      />
      <DemoStorageNotice notice={snapshot.storageNotice} />
      <div className="flex flex-wrap gap-3" aria-label="Approval filters">
        <Button
          variant={filter === "PENDING" ? "secondary" : "ghost"}
          aria-pressed={filter === "PENDING"}
          onClick={() => setFilter("PENDING")}
        >
          Pending ({pending})
        </Button>
        <Button
          variant={filter === "ALL" ? "secondary" : "ghost"}
          aria-pressed={filter === "ALL"}
          onClick={() => setFilter("ALL")}
        >
          All demo requests ({snapshot.state.approvals.length})
        </Button>
      </div>
      {approvals.length === 0 ? (
        <EmptyState
          title="No requests to review"
          description={
            demoIdentity
              ? "Send a proposal for approval from the Buyer Workspace, then return as Demo Approver."
              : "Send a proposal for approval from the Buyer Workspace, then review it here."
          }
          href="/buyer"
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {approvals.map((approval) => {
            const proposal = snapshot.state.proposals.find((p) => p.id === approval.proposalId);
            return (
              <li key={approval.id}>
                <Link
                  href={`/approvals/${approval.id}`}
                  className="block p-4 transition-colors hover:bg-muted md:p-6"
                >
                  <div className="flex flex-wrap justify-between gap-4">
                    <div>
                      <p className="font-medium">Demo purchase · {approval.id}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Proposal version {approval.proposalVersion} · Requested{" "}
                        {timestamp(approval.requestedAt)}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="font-semibold tabular-nums">{money(proposal?.totalGross)}</p>
                      <ApprovalStatus status={approval.status} />
                    </div>
                  </div>
                  <p className="mt-4 text-sm">{approval.reasons.map((r) => r.message).join(" ")}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
