"use client";

import Link from "next/link";
import { simulatorAvailable, useProcurement } from "@/client/use-procurement";
import { PageHeader } from "@/components/layout/page-header";
import type { ProvisionalProposal, ProvisionalSnapshot } from "@/client/provisional/types";
import { PurchaseRequirements } from "./purchase-requirements";
import { ProductComparison, ProductRecommendation } from "./product-recommendation";
import { PurchaseProposalSummary } from "./purchase-proposal-summary";
import { ActivityTimeline } from "./activity-timeline";
import { DemoStorageNotice, EmptyState, IntegrationState } from "./states";

export function ProposalContent({
  proposal,
  snapshot,
}: {
  proposal: ProvisionalProposal;
  snapshot: ProvisionalSnapshot;
}) {
  const intent = snapshot.state.intents.find((i) => i.id === proposal.intentId);
  return (
    <div className="space-y-6">
      <ProductRecommendation proposal={proposal} products={snapshot.products} />
      {intent && <PurchaseRequirements intent={intent} />}
      <PurchaseProposalSummary proposal={proposal} />
      <ProductComparison proposal={proposal} products={snapshot.products} />
    </div>
  );
}

export function ProposalView({ id }: { id: string }) {
  const snapshot = useProcurement();
  if (!simulatorAvailable(snapshot)) return <IntegrationState snapshot={snapshot} />;
  const proposal = snapshot.state.proposals.find((p) => p.id === id);
  if (!proposal)
    return (
      <EmptyState
        page
        title="Proposal not found in this demo"
        description="This link belongs to another session or the local demonstration was reset."
        href="/buyer"
      />
    );
  const conversation = snapshot.state.conversations.find((c) => c.proposalId === id);
  return (
    <div className="mx-auto w-full max-w-conversation space-y-8">
      <DemoStorageNotice notice={snapshot.storageNotice} />
      <PageHeader
        title="Review your purchase"
        description="A synthetic recommendation, with the details behind it."
      />
      {conversation && (
        <Link
          className="inline-block min-h-11 py-3 text-sm text-primary underline underline-offset-4"
          href={`/buyer/conversations/${conversation.id}`}
        >
          Back to conversation
        </Link>
      )}
      <ProposalContent proposal={proposal} snapshot={snapshot} />
      <ActivityTimeline
        items={snapshot.state.activities.filter((a) => a.traceId === proposal.traceId)}
      />
    </div>
  );
}
