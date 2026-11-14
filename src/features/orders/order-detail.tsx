"use client";

import Link from "next/link";
import { useProcurement } from "@/client/use-procurement";
import { PageHeader } from "@/components/layout/page-header";
import { OrderStatus } from "@/features/procurement/status";
import { date, money, timestamp } from "@/features/procurement/format";
import { ActivityTimeline } from "@/features/procurement/activity-timeline";
import { ProductRecommendation } from "@/features/procurement/product-recommendation";
import { DemoStorageNotice, EmptyState, IntegrationState } from "@/features/procurement/states";

export function OrderDetail({ id }: { id: string }) {
  const snapshot = useProcurement();
  if (!snapshot.ready || snapshot.mode !== "mock") return <IntegrationState snapshot={snapshot} />;
  const order = snapshot.state.orders.find((o) => o.id === id);
  if (!order)
    return (
      <EmptyState
        page
        title="Order not found in this demo"
        description="This local order is not available in this tab. The session may have been reset."
        href="/orders"
        action="Back to orders"
      />
    );
  return (
    <div className="mx-auto w-full max-w-conversation space-y-8">
      <DemoStorageNotice notice={snapshot.storageNotice} />
      <PageHeader title="Your simulated order" description={order.id} />
      <OrderStatus />
      <p className="rounded-lg bg-muted p-4 text-sm">
        Created in this browser’s local simulator. This order has not been submitted to Valio’s live
        ordering systems. It does not confirm supplier acceptance or delivery.
      </p>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Demo total, incl. VAT</dt>
          <dd className="mt-1 font-semibold tabular-nums">{money(order.totalGross)} EUR</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Delivery requested</dt>
          <dd className="mt-1">{date(order.intentSnapshot.requestedDeliveryDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Recorded locally</dt>
          <dd className="mt-1">
            <time dateTime={order.committedAt}>{timestamp(order.committedAt)} (Helsinki)</time>
          </dd>
        </div>
      </dl>
      <ProductRecommendation proposal={order.proposalSnapshot} products={snapshot.products} />
      <section className="space-y-3">
        <h2 className="section-title">Purchase references</h2>
        <p className="text-sm">
          <Link
            className="inline-block min-h-11 py-3 text-primary underline underline-offset-4"
            href={`/proposals/${order.proposalId}`}
          >
            View proposal version {order.proposalSnapshot.version}
          </Link>
        </p>
        {order.proposalSnapshot.approvalId ? (
          <Link
            className="inline-block min-h-11 py-3 text-sm text-primary underline underline-offset-4"
            href={`/approvals/${order.proposalSnapshot.approvalId}`}
          >
            View linked demo approval
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            Autonomous scenario · no approval was required by the fictional policy.
          </p>
        )}
      </section>
      <ActivityTimeline
        items={snapshot.state.activities.filter((a) => order.auditEventIds.includes(a.id))}
      />
      <details className="text-caption text-muted-foreground">
        <summary className="min-h-11 py-3">Simulation details</summary>
        <p className="break-all">
          Source: {order.source} · No upstream order reference · Trace: {order.traceId}
        </p>
      </details>
    </div>
  );
}
