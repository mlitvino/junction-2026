"use client";

import Link from "next/link";
import { useProcurement } from "@/client/use-procurement";
import { PageHeader } from "@/components/layout/page-header";
import { OrderStatus } from "@/features/procurement/status";
import { date, money } from "@/features/procurement/format";
import { DemoStorageNotice, EmptyState, IntegrationState } from "@/features/procurement/states";

export function OrdersList() {
  const snapshot = useProcurement();
  if (!snapshot.ready || snapshot.mode !== "mock") return <IntegrationState snapshot={snapshot} />;
  return (
    <div className="mx-auto w-full max-w-data space-y-8">
      <PageHeader
        title="Orders"
        description="Created locally in this browser. No order has been submitted to Valio’s live ordering systems."
      />
      <DemoStorageNotice notice={snapshot.storageNotice} />
      {!snapshot.state.orders.length ? (
        <EmptyState
          title="No simulated orders yet"
          description="Try the autonomous purchase scenario, or approve a pending request as Demo Approver."
          href="/buyer"
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {snapshot.state.orders
            .slice()
            .reverse()
            .map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="block p-4 transition-colors hover:bg-muted md:p-6"
                >
                  <div className="flex flex-wrap justify-between gap-4">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{order.id}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {order.intentSnapshot.items
                          .map((i) => `${i.quantity.value} ${i.quantity.unit} ${i.query}`)
                          .join(", ")}
                      </p>
                      <p className="mt-2 text-caption text-muted-foreground">
                        Delivery requested: {date(order.intentSnapshot.requestedDeliveryDate)}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="font-semibold tabular-nums">{money(order.totalGross)}</p>
                      <OrderStatus />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
