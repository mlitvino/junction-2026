"use client";

import Link from "next/link";
import { useState } from "react";
import { mayAttempt, useWorkspace } from "@/client/use-workspace";
import { usePendingApprovals } from "@/client/use-pending-approvals";
import type { Thread } from "@/client/workspace/model";
import type { Proposal } from "@/shared/contracts/purchasing";
import { cn } from "@/components/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { EmptyState, ErrorMessage, StatusBadge, store } from "./ui";
import { useLoad } from "./use-load";
import { AnimatedPrice } from "./animated-price";

function purchaseTitle(proposal: Proposal) {
  const first = proposal.lines[0];
  if (!first) return "Purchase request";
  const quantity = `${first.quantity} ${first.salesUnit ?? "sales units"}`;
  return `${first.name} (${quantity})${proposal.lines.length > 1 ? ` + ${proposal.lines.length - 1} more` : ""}`;
}

function sourceFor(proposal: Proposal, thread?: Thread): { label: string; icon: IconName } {
  const label =
    thread?.source ??
    (proposal.source === "agent"
      ? "Assistant"
      : proposal.source === "recipe"
        ? "Recipes"
        : "Manual");
  return {
    label,
    icon:
      label === "Restocking"
        ? "restocking"
        : label === "Recipes"
          ? "recipes"
          : label === "Assistant"
            ? "workspace"
            : "approvals",
  };
}

function neededDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function ReviewRow({ proposal, thread }: { proposal: Proposal; thread?: Thread }) {
  const source = sourceFor(proposal, thread);
  const version = thread ? thread.proposals.indexOf(proposal.id) + 1 : null;
  const reasons = proposal.decision.reasons;
  const reason =
    reasons.find((r) => r.outcome === "DENY") ??
    reasons.find(
      (r) =>
        r.outcome === "REQUIRE_APPROVAL" && !["SUGGEST_ONLY", "NO_AUTO_APPROVAL"].includes(r.code),
    ) ??
    reasons.find((r) => r.outcome === "REQUIRE_APPROVAL");
  const defaultApproval = reason && ["SUGGEST_ONLY", "NO_AUTO_APPROVAL"].includes(reason.code);
  const lateDelivery =
    reason?.code === "LATE_DELIVERY"
      ? reason.message.match(
          /^Product \S+ can be delivered on (\d{4}-\d{2}-\d{2}) at the earliest, after the requested (\d{4}-\d{2}-\d{2})\.$/,
        )
      : null;
  const summary = defaultApproval
    ? "Human approval required"
    : lateDelivery?.[1] && lateDelivery[2]
      ? `Product can be delivered on ${neededDate(lateDelivery[1])} at the earliest, after the requested ${neededDate(lateDelivery[2])}.`
      : reason?.message;
  const pending = proposal.approval?.status === "PENDING";
  return (
    <li className="luukku-capsule p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="hidden size-11 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-muted/60 text-primary sm:flex">
          <Icon name={source.icon} />
        </div>
        <div className="grid min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="rounded bg-muted px-2 py-0.5 font-medium uppercase tracking-wider">
                {source.label}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono" title={`Proposal ${proposal.id}`}>
                {proposal.id.slice(0, 8)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">Proposal{version ? ` v${version}` : ""}</span>
              {!pending && <StatusBadge status={proposal.approval?.status ?? proposal.status} />}
            </div>
            <h2 className="mt-1.5 text-base font-semibold leading-snug">
              {purchaseTitle(proposal)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <span>
                Requested by{" "}
                {proposal.approval?.requestedByName ??
                  proposal.createdByName ??
                  "organization member"}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="clock" className="size-3.5 shrink-0" />
                Needed{" "}
                <time dateTime={proposal.pricingDate}>{neededDate(proposal.pricingDate)}</time>
              </span>
              {pending && summary && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={cn(
                      "inline-flex min-w-0 items-start gap-1.5",
                      defaultApproval
                        ? "text-primary"
                        : reason?.outcome === "DENY"
                          ? "text-destructive"
                          : "text-warning",
                    )}
                  >
                    <Icon
                      name={defaultApproval ? "shield-outline" : "info"}
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                    <span className="line-clamp-2" title={summary}>
                      {summary}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-5 lg:justify-end">
            <div className="lg:text-right">
              <p className="whitespace-nowrap luukku-amount text-xl leading-tight tabular-nums">
                <AnimatedPrice value={proposal.totalExclVat} currency={proposal.currency} />
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Excl. VAT</p>
            </div>
            <Link
              href={`/approvals/${proposal.approval!.id}`}
              aria-label={pending ? "Review purchase" : "View purchase details"}
              className={buttonVariants({
                variant: pending ? "default" : "outline",
                className: "min-w-28 gap-3 rounded-lg",
              })}
            >
              {pending ? "Review" : "View details"}
              <Icon name="arrow-right" className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}

export function ToReview() {
  const s = useWorkspace();
  const [history, setHistory] = useState(false);
  const pendingCount = usePendingApprovals();
  useLoad(() => store.refresh(), "to-review");
  const canReview = mayAttempt(s, "approver");
  const all = canReview
    ? s.approvals.map((a) => a.proposal)
    : s.proposals.filter((p) => p.createdBy === s.user?.id && p.approval);
  const threadFor = (id: string) => s.local.threads.find((t) => t.proposals.includes(id));
  // A replacement is known only when both records are present in the same conversation.
  const superseded = all.flatMap((proposal) => {
    if (proposal.status !== "CANCELLED") return [];
    const thread = threadFor(proposal.id);
    const index = thread?.proposals.indexOf(proposal.id) ?? -1;
    const latestId = thread?.proposals.at(-1);
    const latest = s.proposals.find((p) => p.id === latestId);
    return thread && index >= 0 && index < thread.proposals.length - 1 && latest?.approval
      ? [{ proposal, latest, version: index + 1 }]
      : [];
  });
  const pending = all.filter((p) => p.approval?.status === "PENDING");
  const completed = all.filter((p) => p.approval?.status !== "PENDING");
  const rows = history
    ? completed.filter((p) => !superseded.some((r) => r.proposal.id === p.id))
    : pending;
  return (
    <section className="mx-auto w-full max-w-data space-y-6" aria-labelledby="review-title">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 id="review-title" className="text-2xl font-semibold tracking-tight">
            To review
          </h1>
          {pendingCount !== null && (
            <span
              className="rounded-full border border-primary/10 bg-accent px-2.5 py-0.5 text-xs font-medium tabular-nums text-accent-foreground"
              role="status"
            >
              {pendingCount} pending
            </span>
          )}
        </div>
        <div className="inline-flex rounded-xl border bg-muted/70 p-1" aria-label="Review filters">
          {[false, true].map((value) => (
            <Button
              key={String(value)}
              variant="ghost"
              aria-pressed={history === value}
              onClick={() => setHistory(value)}
              className={cn(
                "min-h-8 rounded-lg px-4 text-xs md:min-h-8",
                history === value && "bg-card text-foreground shadow-sm",
              )}
            >
              {value
                ? `History (${completed.length})`
                : `Pending${pendingCount !== null ? ` (${pendingCount})` : ""}`}
            </Button>
          ))}
        </div>
      </header>
      <ErrorMessage error={s.error} />
      {s.error && (
        <Button variant="outline" onClick={() => void store.refresh()}>
          Retry
        </Button>
      )}
      {rows.length > 0 ? (
        <ul
          className="luukku-queue divide-y overflow-hidden rounded-md border border-t-[3px] border-t-primary bg-card shadow-[0_2px_12px_rgba(0,0,0,0.025)]"
          aria-label={history ? "Review history" : "Pending purchases"}
        >
          {rows.map((p) => (
            <ReviewRow key={p.id} proposal={p} thread={threadFor(p.id)} />
          ))}
        </ul>
      ) : (
        !s.error && (
          <EmptyState title={history ? "No completed reviews yet" : "You’re all caught up"}>
            Purchases needing a decision will appear here.
          </EmptyState>
        )
      )}
      {superseded.length > 0 && (
        <ul className="space-y-3" aria-label="Superseded purchases">
          {superseded.map(({ proposal, latest, version }) => (
            <li
              key={proposal.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-5 py-3 text-xs"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Icon name="clock" className="size-4 shrink-0 text-muted-foreground" />
                <span className="break-words">
                  {proposal.id.slice(0, 8)} · Proposal v{version} · {purchaseTitle(proposal)} ·{" "}
                  <AnimatedPrice value={proposal.totalExclVat} currency={proposal.currency} />
                </span>
                <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                  Superseded by {latest.id.slice(0, 8)}
                </span>
              </div>
              <Link
                href={`/approvals/${latest.approval!.id}`}
                className="inline-flex min-h-8 shrink-0 items-center gap-1 text-primary hover:underline"
              >
                View latest
                <Icon name="chevron" className="size-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
