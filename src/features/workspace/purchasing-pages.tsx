"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/client/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  ApprovalCard,
  StatusBadge,
  OrderSummary,
  PriceDisplay,
  EvidenceDisclosure,
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
export function ToReview() {
  const s = useWorkspace(),
    [history, setHistory] = useState(false);
  useLoad(() => store.refresh(), "to-review");
  const canReview = s.user?.roles.includes("approver");
  const pending = s.approvals.filter((a) => a.status === "PENDING");
  const rows = canReview
    ? s.approvals
        .filter((a) => (history ? a.status !== "PENDING" : a.status === "PENDING"))
        .map((a) => a.proposal)
    : s.proposals.filter((p) => p.createdBy === s.user?.id && p.approval);
  return (
    <Page
      title="To review"
      description={
        canReview
          ? "Review purchasing requests and the conditions that need your decision."
          : "Follow the purchasing requests you have sent for review."
      }
      wide
      action={
        <Button variant="outline" onClick={() => void store.refresh()}>
          Refresh
        </Button>
      }
    >
      <ErrorMessage error={s.error} />
      {canReview && (
        <div className="flex gap-3">
          <Button
            variant={!history ? "secondary" : "ghost"}
            aria-pressed={!history}
            onClick={() => setHistory(false)}
          >
            Needs action ({pending.length})
          </Button>
          <Button
            variant={history ? "secondary" : "ghost"}
            aria-pressed={history}
            onClick={() => setHistory(true)}
          >
            History
          </Button>
        </div>
      )}
      {!rows.length && !s.error ? (
        <EmptyState title={history ? "No completed reviews yet" : "You’re all caught up"}>
          Purchases needing a decision will appear here.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {rows.map((p) => (
            <Panel key={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <StatusBadge status={p.status} />
                  <h2 className="mt-3 font-semibold">{p.lines[0]?.name ?? "Purchase request"}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {p.lines.map((l) => `${l.quantity} ${l.salesUnit ?? "units"}`).join(" · ")} ·{" "}
                    {p.approval?.id}
                  </p>
                  <p className="mt-2 text-sm">
                    {p.decision.reasons.map((r) => r.message).join(" ")}
                  </p>
                </div>
                <div className="space-y-4">
                  <PriceDisplay value={p.totalExclVat} />
                  <Link
                    href={`/approvals/${p.approval!.id}`}
                    className={`${buttonVariants({ variant: "outline" })} block`}
                  >
                    {p.approval?.status === "PENDING" ? "Review purchase" : "View details"}
                  </Link>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </Page>
  );
}
export function ReviewDetail({ id }: { id: string }) {
  const s = useWorkspace();
  const router = useRouter();
  useLoad(() => store.refresh(), `review:${id}`);
  const proposal = s.proposals.find((p) => p.approval?.id === id);
  const thread = s.local.threads.find((t) => t.proposals.includes(proposal?.id ?? ""));
  return (
    <Page
      title="Review purchase"
      description="Your decision applies to the exact purchase shown below."
      action={
        <Link href="/approvals" className={buttonVariants({ variant: "ghost" })}>
          Back to review
        </Link>
      }
    >
      <ErrorMessage error={s.error} />
      {proposal ? (
        <>
          <ApprovalCard proposal={proposal} threadId={thread?.id} />
          {thread ? (
            <Link
              href={`/buyer/conversations/${thread.id}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Ask assistant for changes
            </Link>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/buyer/conversations/${store.discussPurchase(proposal.id)}`)
              }
            >
              Discuss in assistant
            </Button>
          )}
          <ActivityTimeline resourceId={proposal.id} />
        </>
      ) : (
        !s.error && (
          <EmptyState title="Review request unavailable">
            Refresh or return to the review queue. Your account may not have access to this request.
          </EmptyState>
        )
      )}
    </Page>
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
export function OrderDetail({ id }: { id: string }) {
  const s = useWorkspace(),
    error = useLoad(() => store.loadOrder(id), `order:${id}`);
  const order = s.orders.find((o) => o.id === id),
    proposal = s.proposals.find((p) => p.id === order?.proposalId);
  const thread = s.local.threads.find((t) => t.proposals.includes(order?.proposalId ?? ""));
  return (
    <Page
      title="Order details"
      description={id}
      action={
        order && (
          <Link href={`/checkout/${id}`} className={buttonVariants()}>
            Continue to checkout
          </Link>
        )
      }
    >
      <ErrorMessage error={error} />
      {order ? (
        <>
          <OrderSummary order={order} />
          <Panel>
            <dl className="grid gap-5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Origin</dt>
                <dd className="mt-2">{thread?.source ?? "Purchasing service"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Needed by</dt>
                <dd className="mt-2">{displayDate(proposal?.pricingDate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved by</dt>
                <dd className="mt-2">
                  {proposal?.approval?.decidedBy === s.user?.id
                    ? (s.user?.username ?? "Organization approver")
                    : proposal?.approval?.decidedBy
                      ? "Authorized organization approver"
                      : "Explicit purchasing policy"}
                </dd>
              </div>
            </dl>
          </Panel>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/proposals/${order.proposalId}`}
              className={buttonVariants({ variant: "outline" })}
            >
              View purchase proposal
            </Link>
            {thread && (
              <Link
                href={`/buyer/conversations/${thread.id}`}
                className={buttonVariants({ variant: "outline" })}
              >
                Discuss in assistant
              </Link>
            )}
          </div>
          <ActivityTimeline resourceId={id} />
          <EvidenceDisclosure title="View technical audit & snapshot evidence">
            <p>
              Order recorded by the purchasing service. Supplier dispatch, reserved delivery slots
              and payment are not connected.
            </p>
            <p>
              Content reference: <span className="break-all">{order.proposalHash}</span>
            </p>
            <p>
              The global audit service is not connected. Activity shown here was observed in this
              browser.
            </p>
          </EvidenceDisclosure>
        </>
      ) : (
        !error && <p role="status">Loading order…</p>
      )}
    </Page>
  );
}
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
