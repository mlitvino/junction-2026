"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/client/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAction } from "@/features/procurement/use-action";
import {
  store,
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  ApprovalCard,
  BasketReviewDrawer,
} from "./ui";
import { ProductPicker } from "./product-picker";

export function ConversationComposer({ id, welcome = false }: { id?: string; welcome?: boolean }) {
  const s = useWorkspace(),
    router = useRouter(),
    action = useAction();
  const key = id ?? "welcome";
  const draft = s.local.drafts[key] ?? "";
  const textarea = useRef<HTMLTextAreaElement>(null);
  const running = id ? s.local.threads.find((t) => t.id === id)?.working : false;
  const [queued, setQueued] = useState(false);
  function set(text: string) {
    store.draft(key, text);
  }
  return (
    <div className={welcome ? "mt-8" : "conversation-composer"}>
      {!welcome && (
        <div className="mb-2 flex gap-2 overflow-x-auto py-1" aria-label="Suggested follow-ups">
          {["Make it 150 litres", "Why this product?", "Show another alternative"].map((text) => (
            <button
              key={text}
              type="button"
              className="min-h-9 shrink-0 rounded-full border bg-card px-3 text-caption hover:bg-accent"
              onClick={() => {
                set(text);
                textarea.current?.focus();
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <ErrorMessage error={action.error} />
      <form
        aria-label="Assistant message"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          void action.run(async () => {
            if (running) {
              setQueued(true);
              return;
            }
            const conversation = id ?? store.newThread(draft.slice(0, 65));
            const text = draft;
            set("");
            if (!id) router.push(`/buyer/conversations/${conversation}`);
            await store.sendMessage(conversation, text);
            setQueued(false);
          });
        }}
        className="rounded-lg border border-input bg-card p-4 focus-within:border-ring"
      >
        <label htmlFor={`message-${key}`} className="sr-only">
          {welcome ? "What do you need?" : "Continue the conversation"}
        </label>
        <textarea
          ref={textarea}
          id={`message-${key}`}
          rows={welcome ? 4 : 2}
          maxLength={5000}
          className="block w-full resize-none bg-transparent text-large-body outline-none focus-visible:outline-none"
          value={draft}
          onChange={(event) => set(event.target.value)}
          placeholder={
            welcome
              ? "Describe what your kitchen needs, or choose a suggestion…"
              : "Ask for a change, add a preference, or clarify the order…"
          }
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-caption text-muted-foreground">
            {running
              ? "You can keep writing while this request is being prepared."
              : "Human approval before purchasing by default"}
          </span>
          <Button
            size={welcome ? "default" : "icon"}
            type="submit"
            aria-label="Send message"
            disabled={action.busy || !draft.trim()}
          >
            {welcome ? "Ask assistant" : <Icon name="arrow" />}
          </Button>
        </div>
      </form>
      {queued && (
        <p role="status" className="mt-2 text-caption text-muted-foreground">
          Your draft is kept. Send it when the current request has finished.
        </p>
      )}
    </div>
  );
}

export function AssistantWelcome() {
  const s = useWorkspace();
  return (
    <div className="mx-auto w-full max-w-conversation py-8 md:py-12">
      <div className="mb-6 flex size-12 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon name="leaf" className="size-6" />
      </div>
      <h1 className="display-title">What can I help you order?</h1>
      <p className="mt-4 text-large-body text-muted-foreground">
        A little help for your kitchen. Tell me what you need, or plan your next service.
      </p>
      <ConversationComposer welcome />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          "Order 100 litres of lactose-free milk",
          "Check low stock and restock to target",
          "Plan ingredients for 1,000 portions",
          "Find products for a purchase",
        ].map((text) => (
          <button
            key={text}
            onClick={() => store.draft("welcome", text)}
            className="min-h-11 rounded-md border bg-card p-4 text-left text-sm hover:bg-accent"
          >
            {text}
            <Icon name="chevron" className="float-right ml-2 size-4" />
          </button>
        ))}
      </div>
      <Link href="/buyer/products" className={`${buttonVariants({ variant: "outline" })} mt-6`}>
        Browse catalog & prepare purchase
      </Link>
      {s.local.threads.length > 0 && (
        <section className="mt-10 border-t pt-6">
          <h2 className="mb-4 text-label font-medium text-muted-foreground">
            Recent conversations
          </h2>
          <ul className="divide-y">
            {s.local.threads.slice(0, 5).map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/buyer/conversations/${thread.id}`}
                  className="flex min-h-12 items-center justify-between gap-4 py-3 text-sm"
                >
                  <span>{thread.title}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {thread.working ? "Preparing" : "Continue"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function AssistantConversation({ id }: { id: string }) {
  const s = useWorkspace(),
    [review, setReview] = useState<string | null>(null);
  const close = useCallback(() => setReview(null), []);
  const thread = s.local.threads.find((t) => t.id === id);
  const recommendation = useRef<HTMLDivElement>(null);
  const currentProposalId = thread?.proposals.at(-1);
  const hasCurrentProposal = s.proposals.some((proposal) => proposal.id === currentProposalId);
  useEffect(() => {
    if (currentProposalId)
      recommendation.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [currentProposalId, hasCurrentProposal]);
  if (!thread)
    return (
      <Page title="Conversation unavailable">
        <EmptyState title="This conversation is stored in another browser">
          <p>Your purchasing records remain available in To review and Orders.</p>
          <Link href="/buyer" className={`${buttonVariants({ variant: "outline" })} mt-6`}>
            Start a conversation
          </Link>
        </EmptyState>
      </Page>
    );
  const activeId = thread.proposals.at(-1),
    active = s.proposals.find((p) => p.id === activeId);
  const drawerProposal =
    review === active?.id &&
    !["CANCELLED", "REJECTED", "ORDERED", "EXPIRED"].includes(active.status)
      ? active
      : undefined;
  return (
    <div className={`conversation-layout ${drawerProposal ? "review-open" : ""}`}>
      <div className="mx-auto w-full max-w-conversation space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="page-title">Assistant</h1>
          <Link href="/buyer" className={buttonVariants({ variant: "ghost" })}>
            New conversation
          </Link>
        </div>
        <div className="space-y-6" aria-label="Conversation messages">
          {thread.messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "user"
                  ? "ml-auto max-w-xl rounded-lg bg-primary px-5 py-4 text-primary-foreground"
                  : "max-w-2xl text-large-body"
              }
            >
              <p className="whitespace-pre-wrap">{message.text}</p>
            </div>
          ))}
        </div>
        {thread.working && (
          <Panel>
            <div role="status">
              <p className="font-medium">{thread.stage || "Preparing your request"}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Understanding request → finding products → checking conditions
              </p>
            </div>
          </Panel>
        )}
        <ErrorMessage error={thread.error} />
        {thread.recipeChoice && !thread.safetyBlocked && (
          <Panel>
            <h2 className="section-title">Which recipe should I use?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {s.recipes.map((recipe) => (
                <Link
                  key={recipe.id}
                  href={`/recipes/${recipe.id}/plan${thread.requirement ? `?requirement=${thread.requirement}` : ""}`}
                  className="rounded-lg border p-4 hover:bg-accent"
                >
                  <h3 className="font-medium">{recipe.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Base: {recipe.baseServings} portions · Plan a batch
                  </p>
                </Link>
              ))}
            </div>
          </Panel>
        )}
        {thread.safetyBlocked && (
          <Panel>
            <h2 className="section-title text-destructive">
              Unable to verify the mandatory dietary requirement
            </h2>
            <p className="mt-3 text-sm">
              A verified safe ingredient was not found. The purchase is blocked; there is no
              approval override for missing safety evidence.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() =>
                  store.draft(id, "Find another product with verified allergen evidence")
                }
              >
                Search another ingredient
              </Button>
              <Link href="/recipes" className={buttonVariants({ variant: "outline" })}>
                Choose another recipe
              </Link>
            </div>
          </Panel>
        )}
        {thread.diff && (
          <div className="rounded-lg bg-secondary p-4 text-sm">
            <h2 className="font-medium">What changed</h2>
            <p className="mt-2">{thread.diff}</p>
          </div>
        )}
        {thread.proposals.map((proposalId, index) => {
          const proposal = s.proposals.find((p) => p.id === proposalId);
          return proposal && proposalId !== activeId ? (
            <details key={proposalId} className="rounded-lg border bg-muted px-4">
              <summary className="min-h-11 py-3 text-sm">
                Proposal v{index + 1} ·{" "}
                {proposal.status === "CANCELLED" ? "Superseded" : "Previous version"} · Read-only
                history
              </summary>
              <div className="py-4 text-sm">
                {proposal.lines.map((l) => `${l.quantity} ${l.salesUnit} ${l.name}`).join(", ")}
                <p className="mt-2">This proposal is no longer the current recommendation.</p>
              </div>
            </details>
          ) : null;
        })}
        {active && (
          <div ref={recommendation} className="scroll-mt-24">
            <ApprovalCard
              proposal={active}
              threadId={id}
              compact
              onReview={() => setReview(active.id)}
            />
          </div>
        )}
        {thread.query === "restocking" && (
          <Link className={buttonVariants()} href="/restocking/new">
            Create restock plan
          </Link>
        )}
        {thread.query && thread.query !== "restocking" && !thread.safetyBlocked && (
          <ProductPicker
            initialQuery={thread.query}
            threadId={id}
            replacementId={
              active && ["READY", "PENDING_APPROVAL", "APPROVED"].includes(active.status)
                ? active.id
                : undefined
            }
          />
        )}
        {active && (
          <Link
            href={`/proposals/${active.id}`}
            className="inline-block min-h-11 py-3 text-sm text-primary underline underline-offset-4"
          >
            Open purchase details & activity
          </Link>
        )}
        <ConversationComposer id={id} />
        {drawerProposal && (
          <BasketReviewDrawer proposal={drawerProposal} threadId={id} onClose={close} />
        )}
        <details className="text-caption text-muted-foreground">
          <summary className="min-h-11 py-3">About this conversation</summary>
          <p>
            {store.mock
              ? "Message history is stored in this browser. Connected purchases are stored by the purchasing service. Product selection and order actions always require explicit review."
              : "Conversation messages stay in this browser; proposals, approvals, orders and audit events are recorded on the backend purchasing service."}
          </p>
          {s.notice && <p className="mt-2">{s.notice}</p>}
        </details>
      </div>
    </div>
  );
}

export function ManualPurchase() {
  return (
    <Page
      title="Find products"
      description="Choose your products and quantities, then prepare a purchase for review."
    >
      <ProductPicker />
    </Page>
  );
}
