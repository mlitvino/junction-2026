"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/client/use-workspace";
import type { Proposal } from "@/shared/contracts/purchasing";
import { InlineActionConfirmation } from "@/components/ui/inline-action-confirmation";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAction } from "@/features/procurement/use-action";
import {
  ErrorMessage,
  OrderSummary,
  Panel,
  ProductLine,
  PriceDisplay,
  StatusBadge,
  store,
} from "./ui";
import { useLoad } from "./use-load";

export function ChatCheckout({ proposal }: { proposal: Proposal }) {
  const s = useWorkspace();
  const action = useAction();
  const thread = s.local.threads.find((t) => t.proposals.includes(proposal.id));
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const orderId = proposal.orderId;
  const loadError = useLoad(
    () => (orderId ? store.loadOrder(orderId) : Promise.resolve()),
    `chat-checkout:${orderId ?? proposal.id}`,
  );
  const order = s.orders.find((o) => o.id === orderId);
  const stale =
    s.local.stale.includes(proposal.id) ||
    (!!proposal.quoteExpiresAt && Date.parse(proposal.quoteExpiresAt) <= clock);
  const canOrder =
    s.user?.roles.includes("buyer") &&
    !stale &&
    !orderId &&
    (proposal.status === "APPROVED" ||
      (proposal.status === "READY" &&
        proposal.lines.every(
          (line) =>
            line.orderable === true &&
            line.availableQuantity !== null &&
            line.availableQuantity >= line.quantity &&
            line.availableDate !== null &&
            line.availableDate.slice(0, 10) <= proposal.pricingDate,
        ) &&
        proposal.decision.outcome === "ALLOW" &&
        proposal.decision.limits.autonomy === "order_within_limits"));
  const canWithdraw =
    s.user?.roles.includes("buyer") &&
    proposal.createdBy === s.user.id &&
    !orderId &&
    ["READY", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status);
  return (
    <div className="space-y-5">
      <ErrorMessage error={loadError} />
      <ErrorMessage error={action.error} />
      {order ? (
        <OrderSummary order={order} />
      ) : (
        <Panel>
          <h3 className="text-sm font-semibold">
            {orderId ? "Loading recorded order…" : "Confirm your purchase"}
          </h3>
          <div className="mt-3 divide-y">
            {proposal.lines.map((line, index) => (
              <ProductLine key={`${line.productId}-${index}`} line={line} />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-dashed pt-4">
            <span>Total</span>
            <PriceDisplay value={proposal.totalExclVat} currency={proposal.currency} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Delivery requested for {proposal.pricingDate}. Prices and availability are checked again
            when you confirm.
          </p>
        </Panel>
      )}
      {!orderId && (
        <Panel>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto">
              <StatusBadge status={proposal.status} />
            </span>
            {canWithdraw && (
              <InlineActionConfirmation
                title="Withdraw this request?"
                description="This purchase and its review will no longer be actionable."
                trigger="Withdraw request"
                confirmLabel="Withdraw"
                destructive
                onConfirm={() => store.cancel(proposal.id)}
              />
            )}
            {canOrder ? (
              <>
                <InlineActionConfirmation
                  title="Record this order?"
                  holdToConfirm
                  description="Confirm the products, quantities and total shown above. Prices and availability are checked again before confirmation."
                  trigger="Buy"
                  confirmLabel="Buy"
                  onConfirm={() => store.placeOrder(proposal.id).then(() => {})}
                />
              </>
            ) : (
              <p className="order-last w-full text-sm text-muted-foreground">
                {stale
                  ? "This quote needs refreshing. Prepare an updated proposal before ordering."
                  : "A buyer can confirm this purchase once it is approved."}
              </p>
            )}
          </div>
          {stale &&
            thread &&
            s.user?.roles.includes("buyer") &&
            proposal.createdBy === s.user.id &&
            ["READY", "APPROVED", "PENDING_APPROVAL", "EXPIRED"].includes(proposal.status) && (
              <Button
                className="mt-4"
                disabled={action.busy}
                onClick={() =>
                  void action.run(() =>
                    store.createPurchase(
                      {
                        lines: proposal.lines.map((line) => ({
                          productId: line.productId,
                          quantity: line.quantity,
                        })),
                        date: proposal.pricingDate,
                      },
                      thread.id,
                      thread.source,
                      proposal.id,
                    ),
                  )
                }
              >
                Refresh prices &amp; prepare updated proposal
              </Button>
            )}
        </Panel>
      )}
      {orderId && (
        <Panel>
          <StatusBadge status="APPROVED" label="Order confirmed" />
          <h3 className="mt-4 text-sm font-semibold">Order confirmed</h3>
          <p className="mt-3 text-sm text-muted-foreground">
            Your order has been recorded. View its receipt and details on the order page.
          </p>
          <Link
            href={`/orders/${orderId}`}
            className={buttonVariants({ variant: "outline", className: "mt-4" })}
          >
            View order details
          </Link>
        </Panel>
      )}
    </div>
  );
}
