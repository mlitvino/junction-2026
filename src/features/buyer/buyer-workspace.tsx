"use client";

import Link from "next/link";
import { useProcurement } from "@/client/use-procurement";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { BuyerWelcome } from "./buyer-welcome";
import { AgentProgress } from "@/features/procurement/agent-progress";
import { PurchaseRequirements } from "@/features/procurement/purchase-requirements";
import { ProposalContent } from "@/features/procurement/proposal-view";
import {
  DemoStorageNotice,
  EmptyState,
  ErrorState,
  IntegrationState,
} from "@/features/procurement/states";

export function BuyerWorkspace() {
  const snapshot = useProcurement();
  if (!snapshot.ready || snapshot.mode !== "mock") return <IntegrationState snapshot={snapshot} />;
  return (
    <>
      <DemoStorageNotice notice={snapshot.storageNotice} />
      <BuyerWelcome />
      {snapshot.state.conversations.length > 0 && (
        <section
          className="mx-auto mt-8 w-full max-w-conversation border-t pt-6"
          aria-labelledby="recent-title"
        >
          <h2 id="recent-title" className="mb-3 text-sm font-semibold">
            Recent demo conversations
          </h2>
          <ul className="divide-y">
            {snapshot.state.conversations
              .slice(-5)
              .reverse()
              .map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href={`/buyer/conversations/${conversation.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 text-sm hover:text-primary"
                  >
                    <span>{conversation.title}</span>
                    <span className="text-caption text-muted-foreground">
                      {conversation.status === "RUNNING"
                        ? "Demo running"
                        : conversation.status === "INTERRUPTED"
                          ? "Interrupted"
                          : "View conversation"}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function BuyerConversation({ id }: { id: string }) {
  const snapshot = useProcurement();
  if (!snapshot.ready || snapshot.mode !== "mock") return <IntegrationState snapshot={snapshot} />;
  const conversation = snapshot.state.conversations.find((c) => c.id === id);
  if (!conversation)
    return (
      <EmptyState
        page
        title="Conversation not found in this demo"
        description="The local session may have been reset. Demo data is stored only in this browser tab."
        href="/buyer"
      />
    );
  const proposal = snapshot.state.proposals.find((p) => p.id === conversation.proposalId);
  const intent = snapshot.state.intents.find((i) => i.id === conversation.intentId);
  return (
    <div className="mx-auto w-full max-w-conversation space-y-8">
      <PageHeader
        title="Your purchasing conversation"
        description="Scripted demo · all products, prices and availability are synthetic."
        action={
          <Link href="/buyer" className={buttonVariants({ variant: "outline" })}>
            New request
          </Link>
        }
      />
      <DemoStorageNotice notice={snapshot.storageNotice} />
      <div className="space-y-5" aria-label="Conversation messages">
        {conversation.messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user" ? "ml-auto max-w-xl rounded-lg bg-muted p-4" : "max-w-2xl"
            }
          >
            <p className="mb-2 text-caption font-medium text-muted-foreground">
              {message.role === "user" ? "You · demo request" : "Simulated assistant"}
            </p>
            <p className="whitespace-pre-wrap text-large-body">{message.content}</p>
          </div>
        ))}
      </div>
      <AgentProgress conversation={conversation} />
      <ErrorState message={conversation.error} />
      {conversation.status === "INTERRUPTED" && (
        <Link className={buttonVariants({ variant: "outline" })} href="/buyer">
          Start a new demo request
        </Link>
      )}
      {proposal ? (
        <>
          <ProposalContent proposal={proposal} snapshot={snapshot} />
          <Link
            href={`/proposals/${proposal.id}`}
            className="inline-block min-h-11 py-3 text-sm text-primary underline underline-offset-4"
          >
            Open proposal and activity
          </Link>
        </>
      ) : (
        intent && <PurchaseRequirements intent={intent} />
      )}
    </div>
  );
}
