"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/client/use-workspace";
import { resolveActiveProposal } from "@/client/workspace/service";
import { getConversationStatus, getConversationTimeline } from "@/client/workspace/model";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { useAction } from "@/features/procurement/use-action";
import {
  store,
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  ApprovalCard,
  BasketReviewDrawer,
  StatusBadge,
} from "./ui";
import { ProductPicker } from "./product-picker";
import { ChatCheckout } from "./chat-checkout";

const suggestions = [
  { text: "Order 100 litres of lactose-free milk", icon: "orders" },
  { text: "Check low stock and restock to target", icon: "restocking" },
  { text: "Plan ingredients for 1,000 portions", icon: "recipes" },
  { text: "Find products for a purchase", icon: "search" },
] satisfies { text: string; icon: IconName }[];

export function ConversationComposer({ id, welcome = false }: { id?: string; welcome?: boolean }) {
  const s = useWorkspace(),
    router = useRouter(),
    action = useAction();
  const key = id ?? "welcome";
  const storedDraft = s.local.drafts[key] ?? "";
  const draft = welcome ? storedDraft.replace(/[\r\n]+/g, " ") : storedDraft;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const composerSpace = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (welcome || !composer.current || !composerSpace.current) return;
    const content = composer.current;
    const space = composerSpace.current;
    const reserveSpace = () => {
      space.style.height = `${content.offsetHeight}px`;
    };
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(content);
    return () => observer.disconnect();
  }, [welcome]);
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${Math.min(field.scrollHeight, 192)}px`;
      field.style.overflowY = field.scrollHeight > 192 ? "auto" : "hidden";
    };
    resize();
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = field.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(field);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [draft, welcome]);
  const running = id ? s.local.threads.find((t) => t.id === id)?.working : false;
  const [queued, setQueued] = useState(false);
  function set(text: string) {
    store.draft(key, text);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      if (welcome) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (!event.repeat && !action.busy && draft.trim()) event.currentTarget.form?.requestSubmit();
  }
  const sendButton = (
    <Button
      size="icon"
      type="submit"
      aria-label="Send message"
      disabled={action.busy || !draft.trim()}
      className="shrink-0 rounded-full"
    >
      <Icon name="arrow" />
    </Button>
  );
  return (
    <div ref={composerSpace} className={welcome ? "mt-6 sm:mt-8" : "conversation-composer-space"}>
      <div ref={composer} className={welcome ? undefined : "conversation-composer"}>
        <ErrorMessage error={action.error} />
        <form
          aria-label="Assistant message"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim() || action.busy) return;
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
          className="flex items-end gap-2 rounded-[28px] border border-input bg-card p-2 pl-4 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10"
        >
          <label htmlFor={`message-${key}`} className="sr-only">
            {welcome ? "What do you need?" : "Continue the conversation"}
          </label>
          {welcome ? (
            <>
              <p id="welcome-composer-hint" className="sr-only">
                Press Enter to send. Human approval is required before purchasing by default.
              </p>
              <input
                id={`message-${key}`}
                type="text"
                maxLength={5000}
                aria-describedby="welcome-composer-hint"
                className="h-10 min-w-0 flex-1 bg-transparent px-1 text-large-body outline-none placeholder:text-muted-foreground focus-visible:outline-none"
                value={draft}
                onChange={(event) => set(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you need…"
              />
            </>
          ) : (
            <textarea
              ref={textarea}
              id={`message-${key}`}
              rows={1}
              maxLength={5000}
              aria-describedby={`message-hint-${key}`}
              className="block h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-large-body leading-6 outline-none focus-visible:outline-none"
              value={draft}
              onChange={(event) => set(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message the assistant…"
            />
          )}
          {!welcome && (
            <p id={`message-hint-${key}`} className="sr-only">
              Press Enter to send. Shift+Enter adds a new line.
            </p>
          )}
          {sendButton}
        </form>
        {queued && (
          <p role="status" className="mt-2 text-caption text-muted-foreground">
            Your draft is kept. Send it when the current request has finished.
          </p>
        )}
      </div>
    </div>
  );
}

export function AssistantWelcome() {
  const s = useWorkspace();
  return (
    <div className="mx-auto flex w-full max-w-conversation flex-1 flex-col justify-center py-8 md:py-12">
      <div className="text-center">
        <h1 className="display-title">What can I help you order?</h1>
        <p className="mx-auto mt-3 max-w-2xl text-large-body text-muted-foreground">
          A little help for your kitchen. Tell me what you need, or plan your next service.
        </p>
      </div>
      <ConversationComposer welcome />
      <div className="mt-5">
        <details className="group/suggestions">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-label font-medium text-muted-foreground transition-colors hover:text-foreground">
            Suggestions{" "}
            <Icon
              name="chevron"
              className="size-3.5 transition-transform group-open/suggestions:rotate-90 motion-reduce:transition-none"
            />
          </summary>
          <div className="space-y-2 pb-4 pt-2">
            {suggestions.map(({ text, icon }) => (
              <button
                key={text}
                type="button"
                title={text}
                onClick={() => {
                  store.draft("welcome", text);
                  document.getElementById("message-welcome")?.focus();
                }}
                className="group flex min-h-12 w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
              >
                <Icon
                  name={icon}
                  className="size-5 shrink-0 text-muted-foreground group-hover:text-primary"
                />
                <span className="min-w-0 flex-1 truncate">{text}</span>
                <Icon name="chevron" className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </details>
        {s.local.threads.length > 0 && (
          <details className="group/recent border-t">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-label font-medium text-muted-foreground transition-colors hover:text-foreground">
              Recent conversations{" "}
              <Icon
                name="chevron"
                className="size-3.5 transition-transform group-open/recent:rotate-90 motion-reduce:transition-none"
              />
            </summary>
            <ul className="divide-y pb-2">
              {s.local.threads.slice(0, 5).map((thread) => {
                const status = getConversationStatus(thread, s);
                return (
                  <li key={thread.id}>
                    <Link
                      href={`/buyer/conversations/${thread.id}`}
                      title={thread.title}
                      className="grid min-h-14 grid-cols-[20px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-md px-2 py-3 text-sm transition-colors hover:bg-muted sm:grid-cols-[20px_minmax(0,1fr)_auto]"
                    >
                      <Icon name="workspace" className="size-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{thread.title}</span>
                      <span className="col-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-end">
                        <StatusBadge status={status.status} label={status.label} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

export function AssistantConversation({ id }: { id: string }) {
  const s = useWorkspace(),
    [review, setReview] = useState<string | null>(null),
    [checkout, setCheckout] = useState<string | null>(null);
  const close = useCallback(() => {
    setReview(null);
    setCheckout(null);
  }, []);
  const openCheckout = (proposalId: string) => {
    setReview(proposalId);
    setCheckout(proposalId);
  };
  const thread = s.local.threads.find((t) => t.id === id);
  const recommendation = useRef<HTMLDivElement>(null);
  const active = resolveActiveProposal(thread, s.proposals);
  const currentProposalId = active?.id;
  const hasCurrentProposal =
    !!active &&
    (!thread?.timeline ||
      thread.timeline.some(
        (entry) => entry.kind === "proposal" && entry.proposalId === active.id,
      ));
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
  const activeId = active?.id;
  const drawerProposal =
    review === active?.id &&
    !["CANCELLED", "REJECTED", "ORDERED", "EXPIRED"].includes(active.status)
      ? active
      : undefined;
  return (
    <div
      className={`conversation-layout flex flex-1 flex-col ${drawerProposal ? "review-open" : ""}`}
    >
      <div className="mx-auto flex w-full max-w-conversation flex-1 flex-col">
        <h1 className="sr-only">Assistant</h1>
        <div className="space-y-6 pb-6">
          <div className="space-y-6" aria-label="Conversation messages">
            {getConversationTimeline(thread, s.proposals).map((entry, index) => {
              if (entry.kind === "message") {
                const message = thread.messages[entry.index];
                return message ? (
                  <div
                    key={`message-${entry.index}`}
                    className={
                      message.role === "user"
                        ? "luukku-message ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-5 py-3 text-sm leading-6 text-primary-foreground sm:max-w-xl"
                        : "luukku-message max-w-2xl text-large-body"
                    }
                  >
                    <p className="whitespace-pre-wrap break-words">{message.text}</p>
                  </div>
                ) : null;
              }
              if (entry.kind === "products")
                return (
                  <ProductPicker
                    key={entry.id}
                    pickerId={entry.id}
                    initialQuery={entry.query}
                    threadId={id}
                    replacementId={entry.replacementId}
                    readOnly={!!entry.closed || !!entry.proposalId || !!thread.safetyBlocked}
                    completedProposal={s.proposals.find((p) => p.id === entry.proposalId)}
                  />
                );
              const proposal = s.proposals.find((p) => p.id === entry.proposalId);
              if (!proposal) return null;
              if (proposal.id !== activeId) {
                const version = thread.proposals.indexOf(proposal.id) + 1;
                if (proposal.status === "BLOCKED") {
                  return (
                    <details
                      key={proposal.id}
                      className="rounded-lg border border-destructive/40 bg-destructive/5 px-4"
                      open
                    >
                      <summary className="min-h-11 py-3 text-sm font-medium text-destructive">
                        Proposal v{version} · Change blocked by policy · Previous proposal kept
                        active
                      </summary>
                      <div className="space-y-2 py-3 text-sm">
                        <p>
                          Attempted change:{" "}
                          {proposal.lines
                            .map((l) => `${l.quantity} ${l.salesUnit} ${l.name}`)
                            .join(", ")}
                        </p>
                        {proposal.decision.reasons.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5 text-destructive">
                            {proposal.decision.reasons.map((r, rIdx) => (
                              <li key={rIdx}>{r.message}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  );
                }
                return (
                  <details key={proposal.id} className="rounded-lg border bg-muted px-4">
                    <summary className="min-h-11 py-3 text-sm">
                      Proposal v{version} ·{" "}
                      {proposal.status === "CANCELLED" ? "Superseded" : "Previous version"} ·
                      Read-only history
                    </summary>
                    <div className="py-4 text-sm">
                      {proposal.lines
                        .map((l) => `${l.quantity} ${l.salesUnit} ${l.name}`)
                        .join(", ")}
                      <p className="mt-2">This proposal is no longer the current recommendation.</p>
                    </div>
                  </details>
                );
              }
              return (
                <div
                  key={`proposal-${index}`}
                  ref={recommendation}
                  className="scroll-mt-24 space-y-4"
                >
                  {thread.diff && (
                    <div className="rounded-lg bg-secondary p-4 text-sm">
                      <h2 className="font-medium">What changed</h2>
                      <p className="mt-2">{thread.diff}</p>
                    </div>
                  )}
                  <ApprovalCard
                    key={proposal.id}
                    proposal={proposal}
                    threadId={id}
                    compact
                    onReview={() => {
                      setCheckout(null);
                      setReview(proposal.id);
                    }}
                    onCheckout={() => openCheckout(proposal.id)}
                  />
                  <Link
                    href={`/proposals/${proposal.id}`}
                    className="inline-block min-h-11 py-3 text-sm text-primary underline underline-offset-4"
                  >
                    Open purchase details & activity
                  </Link>
                </div>
              );
            })}
          </div>
          {thread.working && (
            <div className="flex max-w-2xl items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                <Icon name="agents" className="size-4" />
              </span>
              <div className="min-w-0 flex-1 pt-1" role="status" aria-live="polite">
                <p className="text-sm">Preparing your request.</p>
                <details className="group/progress mt-3 rounded-lg border bg-card px-4 text-caption">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3">
                    <span className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
                    <span className="min-w-0 flex-1">
                      {thread.stage || "Checking available options…"}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      View progress
                      <Icon
                        name="chevron"
                        className="size-3 transition-transform group-open/progress:rotate-90"
                      />
                    </span>
                  </summary>
                  <p className="border-t py-3 leading-5 text-muted-foreground">
                    {thread.stage || "Preparing your request"}. You can continue writing below.
                  </p>
                </details>
              </div>
            </div>
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
          {thread.recipeReconciliation && (
            <Panel>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="section-title">
                  Recipe inventory check · {thread.recipeReconciliation.recipeName}
                </h2>
                <span className="text-caption text-muted-foreground">
                  {thread.recipeReconciliation.requestedServings} portions (
                  {thread.recipeReconciliation.scaleFactor}× base)
                </span>
              </div>
              <div className="mt-4 divide-y text-sm">
                {thread.recipeReconciliation.items.map((item, idx) => (
                  <div
                    key={`${item.productName}:${idx}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div>
                      <p className="font-medium">
                        {item.productName}{" "}
                        <span className="font-normal text-muted-foreground">
                          — {item.productType}
                        </span>
                      </p>
                      <p className="text-caption text-muted-foreground">
                        Total needed: {Number(item.totalNeededQuantity.toFixed(3))}{" "}
                        {item.normalizedUnit} · Inventory stock:{" "}
                        {Number(item.inventoryStockQuantity.toFixed(3))} {item.normalizedUnit}
                      </p>
                    </div>
                    <span
                      className={`text-caption font-medium tabular-nums ${
                        item.coveredByInventory ? "text-success" : "text-foreground"
                      }`}
                    >
                      {item.coveredByInventory
                        ? "Covered by stock"
                        : `Actually needed: ${Number(item.actuallyNeededQuantity.toFixed(3))} ${item.normalizedUnit}`}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {thread.query === "restocking" && (
            <Link className={buttonVariants()} href="/restocking/new">
              Create restock plan
            </Link>
          )}
        </div>
        <ConversationComposer id={id} />
        {drawerProposal && (
          <BasketReviewDrawer
            proposal={drawerProposal}
            threadId={id}
            onClose={close}
            onCheckout={() => openCheckout(drawerProposal.id)}
          >
            {checkout === drawerProposal.id ? (
              <ChatCheckout key={drawerProposal.id} proposal={drawerProposal} />
            ) : undefined}
          </BasketReviewDrawer>
        )}
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
