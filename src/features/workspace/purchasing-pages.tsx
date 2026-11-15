"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/client/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { AuditEvent, OrderReceipt } from "@/shared/contracts/purchasing";
import {
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  ApprovalCard,
  StatusBadge,
  OrderSummary,
  ReceiptPanel,
  PriceDisplay,
  inputClass,
  displayDate,
  store,
} from "./ui";
import { useLoad } from "./use-load";

export function ActivityTimeline({
  resourceId,
  proposalId,
}: {
  resourceId?: string;
  proposalId?: string;
}) {
  const s = useWorkspace();
  const [serverEvents, setServerEvents] = useState<AuditEvent[] | null>(null);
  const targetProposalId = proposalId ?? resourceId;
  useEffect(() => {
    let active = true;
    if (store.mock || !targetProposalId) return;
    store.api
      .getProposalAudit(targetProposalId)
      .then((res) => {
        if (active) setServerEvents(res.items);
      })
      .catch(() => {
        if (active) setServerEvents(null);
      });
    return () => {
      active = false;
    };
  }, [targetProposalId]);
  const localEvents = s.local.activities
    .filter((a) => !resourceId || a.resourceId === resourceId)
    .slice()
    .reverse();
  const events =
    !store.mock && serverEvents && serverEvents.length > 0
      ? serverEvents.map((e) => ({
          id: e.id,
          at: e.createdAt,
          text: `${e.summary}${e.actorName ? ` · ${e.actorName} (${e.actorType})` : ` · ${e.actorType}`}`,
        }))
      : localEvents.map((e) => ({ id: e.id, at: e.at, text: e.text }));
  return (
    <section>
      <h2 className="section-title mb-5">Activity &amp; lifecycle</h2>
      {events.length ? (
        <ol className="space-y-5 border-l pl-5">
          {events.map((event) => (
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
          {store.mock
            ? "No browser-local activity is available for this record."
            : "No recorded audit events are available for this record."}
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
          <details className="luukku-audit rounded-md border px-6 py-2">
            <summary className="cursor-pointer py-3 text-xs text-muted-foreground">
              Activity &amp; lifecycle
            </summary>
            <div className="pb-4 pt-2">
              <ActivityTimeline resourceId={proposal.id} proposalId={proposal.id} />
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
  const router = useRouter(),
    s = useWorkspace(),
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
          <ApprovalCard
            key={p.id}
            proposal={p}
            threadId={thread?.id}
            onRevised={(next) => {
              if (next.status !== "BLOCKED" && next.id !== p.id) {
                router.replace(`/proposals/${next.id}`);
              }
            }}
          />
          <ActivityTimeline resourceId={p.id} proposalId={p.id} />
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
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  useEffect(() => {
    let active = true;
    if (!order) return;
    void store.api
      .getOrderReceipt(id)
      .then((res) => {
        if (active) setReceipt(res);
      })
      .catch(() => {
        /* Receipt remains optional if unavailable. */
      });
    return () => {
      active = false;
    };
  }, [id, order]);
  return (
    <Page title="Checkout" description="Review your recorded purchase, receipt and payment availability.">
      <ErrorMessage error={error} />
      {order && (
        <>
          <OrderSummary order={order} />
          {receipt && <ReceiptPanel receipt={receipt} />}
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
