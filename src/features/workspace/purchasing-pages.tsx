"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "@/client/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  ApprovalCard,
  StatusBadge,
  OrderSummary,
  PriceDisplay,
  inputClass,
  displayDate,
  store,
} from "./ui";
import { useLoad } from "./use-load";

export function ActivityTimeline({ resourceId }: { resourceId?: string }) {
  const s = useWorkspace();
  const events = s.local.activities.filter((a) => !resourceId || a.resourceId === resourceId);
  return (
    <section>
      <h2 className="section-title mb-5">Activity & lifecycle</h2>
      {events.length ? (
        <ol className="space-y-5 border-l pl-5">
          {events
            .slice()
            .reverse()
            .map((event) => (
              <li key={event.id}>
                <p className="text-sm">{event.text}</p>
                <time className="mt-1 block text-caption text-muted-foreground" dateTime={event.at}>
                  {displayDate(event.at)}
                </time>
              </li>
            ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          No browser-local activity is available for this record.
        </p>
      )}
    </section>
  );
}
export { ToReview } from "./to-review";

export function ReviewDetail({ id }: { id: string }) {
  const s = useWorkspace();
  useLoad(() => store.refresh(), `review:${id}`);
  const proposal = s.proposals.find((p) => p.approval?.id === id);
  const thread = s.local.threads.find((t) => t.proposals.includes(proposal?.id ?? ""));
  return (
    <div className="mx-auto w-full max-w-[860px] space-y-4">
      <Link
        href="/approvals"
        className="mb-2 inline-flex min-h-9 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Icon name="arrow-left" className="size-3.5" />
        Back to review list
      </Link>
      <ErrorMessage error={s.error} />
      {proposal ? (
        <>
          <ApprovalCard key={proposal.id} proposal={proposal} threadId={thread?.id} reviewLayout />
          <details className="rounded-xl border bg-card px-6 py-2">
            <summary className="cursor-pointer py-3 text-xs text-muted-foreground">
              Activity & lifecycle
            </summary>
            <div className="pb-4 pt-2">
              <ActivityTimeline resourceId={proposal.id} />
            </div>
          </details>
        </>
      ) : (
        !s.error && (
          <EmptyState title="Review request unavailable">
            Refresh or return to the review queue. Your account may not have access to this request.
          </EmptyState>
        )
      )}
    </div>
  );
}

export function PurchaseDetail({ id }: { id: string }) {
  const s = useWorkspace(),
    error = useLoad(() => store.loadProposal(id), `proposal:${id}`);
  const p = s.proposals.find((p) => p.id === id),
    thread = s.local.threads.find((t) => t.proposals.includes(id));
  return (
    <Page
      title="Purchase proposal"
      description="Review the products, quantities and purchasing conditions."
    >
      <ErrorMessage error={error || s.error} />
      {p ? (
        <>
          <ApprovalCard proposal={p} threadId={thread?.id} />
          <ActivityTimeline resourceId={p.id} />
        </>
      ) : (
        !error && <p role="status">Loading purchase details…</p>
      )}
    </Page>
  );
}
export function Orders() {
  const s = useWorkspace(),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  useLoad(() => store.refresh(), "orders");
  const recorded = s.orders.filter((o) =>
    `${o.id} ${o.lines.map((l) => l.name).join(" ")}`.toLowerCase().includes(search.toLowerCase()),
  );
  const awaiting = s.proposals.filter(
    (p) =>
      ["READY", "PENDING_APPROVAL", "APPROVED"].includes(p.status) &&
      `${p.id} ${p.lines.map((l) => l.name).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <Page
      title="Orders"
      description="Your kitchen’s purchases and recorded orders."
      wide
      action={
        <Button variant="outline" onClick={() => void store.refresh()}>
          Refresh
        </Button>
      }
    >
      <ErrorMessage error={s.error} />
      <div className="flex flex-wrap gap-4">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search orders</span>
          <input
            type="search"
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order or product"
          />
        </label>
        <label>
          <span className="sr-only">Order status</span>
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All purchases</option>
            <option value="recorded">Recorded</option>
            <option value="review">Awaiting review</option>
          </select>
        </label>
      </div>
      {status !== "review" &&
        recorded.map((order) => (
          <Link
            href={`/orders/${order.id}`}
            key={order.id}
            className="block rounded-lg border bg-card p-5 transition-colors hover:bg-muted"
          >
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="font-semibold">{order.lines[0]?.name ?? "Order"}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {order.id} · {displayDate(order.createdAt)}
                </p>
                <div className="mt-3">
                  <StatusBadge status={order.status} />
                </div>
              </div>
              <PriceDisplay value={order.totalExclVat} />
            </div>
          </Link>
        ))}
      {status !== "recorded" &&
        awaiting.map((p) => (
          <Link
            key={p.id}
            href={`/proposals/${p.id}`}
            className="block rounded-lg border bg-card p-5"
          >
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <h2 className="font-medium">{p.lines[0]?.name}</h2>
                <div className="mt-3">
                  <StatusBadge status={p.status} />
                </div>
              </div>
              <PriceDisplay value={p.totalExclVat} />
            </div>
          </Link>
        ))}
      {!recorded.length && !awaiting.length && !s.error && (
        <EmptyState title="No purchases found">
          <Link href="/buyer/products" className={`${buttonVariants({ variant: "outline" })} mt-4`}>
            Prepare a purchase
          </Link>
        </EmptyState>
      )}
    </Page>
  );
}
export { OrderDetail } from "./order-detail";

export function Checkout({ id }: { id: string }) {
  const s = useWorkspace(),
    error = useLoad(() => store.loadOrder(id), `checkout:${id}`),
    order = s.orders.find((o) => o.id === id);
  return (
    <Page title="Checkout" description="Review your recorded purchase and payment availability.">
      <ErrorMessage error={error} />
      {order && (
        <>
          <OrderSummary order={order} />
          <Panel>
            <StatusBadge status="PENDING" label="Payment unavailable" />
            <h2 className="section-title mt-4">Online payment is not connected</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              No payment has been processed. The order is recorded, but supplier dispatch and
              payment require a connected fulfillment service.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={`/orders/${id}`} className={buttonVariants()}>
                View order details
              </Link>
              <Link href="/orders" className={buttonVariants({ variant: "outline" })}>
                Back to Orders
              </Link>
            </div>
          </Panel>
        </>
      )}
    </Page>
  );
}
