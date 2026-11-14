"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Order, Proposal, ProposalLine } from "@/shared/contracts/purchasing";
import type { Thread } from "@/client/workspace/model";
import { useWorkspace } from "@/client/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { useAction } from "@/features/procurement/use-action";
import { ErrorMessage, Panel, StatusBadge, displayDate, eur, store } from "./ui";
import { useLoad } from "./use-load";

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Helsinki",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function OrderItem({
  line,
  currency,
  date,
  showSupplier,
}: {
  line: ProposalLine;
  currency: string;
  date?: string;
  showSupplier: boolean;
}) {
  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 gap-y-3 py-5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:py-6">
      <span className="flex size-10 items-center justify-center rounded-md border bg-muted text-primary">
        <Icon name="restocking" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-6">{line.name}</h3>
        {showSupplier && line.vendorName && (
          <p className="mt-1 text-caption text-muted-foreground">{line.vendorName}</p>
        )}
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">
            {line.quantity} {line.salesUnit ?? "sales units"}
          </span>
          {date && (
            <>
              {" "}
              <span aria-hidden="true">·</span> Requested delivery: {displayDate(date)}
            </>
          )}
        </p>
        <p className="mt-1 text-caption leading-5 text-muted-foreground">
          Unit price: {eur(line.unitPriceExclVat, currency)} / {line.salesUnit ?? "sales unit"}{" "}
          (excl. VAT)
        </p>
      </div>
      <div className="col-start-2 sm:col-start-3 sm:text-right">
        <p className="text-base font-semibold tabular-nums">
          {eur(line.lineTotalExclVat, currency)}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">excl. VAT</p>
      </div>
    </li>
  );
}

type LifecycleEntry = { id: string; at: string; text: string; icon: IconName; complete?: boolean };

function OrderLifecycle({
  order,
  proposal,
  thread,
  approvedBy,
  policyAuthorized,
}: {
  order: Order;
  proposal?: Proposal;
  thread?: Thread;
  approvedBy: string | null;
  policyAuthorized: boolean;
}) {
  const entries: LifecycleEntry[] = [
    {
      id: "recorded",
      at: order.createdAt,
      text: `Order ${order.id} recorded by the purchasing service`,
      icon: "check",
      complete: true,
    },
  ];
  if (proposal) {
    const revision =
      thread && thread.proposals.length > 1 ? thread.proposals.indexOf(proposal.id) + 1 : undefined;
    entries.push({
      id: "prepared",
      at: proposal.createdAt,
      text: `Purchase proposal${revision ? ` v${revision}` : ""} prepared`,
      icon: "clock",
    });
    if (approvedBy && proposal.approval?.decidedAt)
      entries.push({
        id: "approved",
        at: proposal.approval.decidedAt,
        text: `Approved by ${approvedBy}`,
        icon: "check",
        complete: true,
      });
    else if (policyAuthorized)
      entries.push({
        id: "policy",
        at: proposal.decision.evaluatedAt,
        text: "Authorized under explicitly configured purchasing limits",
        icon: "check",
        complete: true,
      });
  }
  const request = thread?.messages.find((message) => message.role === "user");
  if (request)
    entries.push({
      id: "requested",
      at: request.at,
      text: `Initial request created in ${thread?.source ?? "the workspace"}`,
      icon: "workspace",
    });
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <ol className="relative mt-6 space-y-5 before:absolute before:inset-y-2 before:left-2.5 before:w-px before:bg-border">
      {entries.map((entry) => (
        <li key={entry.id} className="relative flex items-start gap-3">
          <span
            className={`relative flex size-5 shrink-0 items-center justify-center rounded-full ${entry.complete ? "bg-success text-success-foreground" : "bg-card text-muted-foreground"}`}
          >
            <Icon name={entry.icon} className={entry.complete ? "size-3.5" : "size-[18px]"} />
          </span>
          <p className="min-w-0 text-sm leading-5 [overflow-wrap:anywhere]">
            <time
              dateTime={entry.at}
              title={`${displayDate(entry.at)}, ${time(entry.at)}`}
              className="mr-2 text-caption tabular-nums text-muted-foreground"
            >
              {displayDate(entry.at) !== displayDate(order.createdAt) &&
                `${displayDate(entry.at)} · `}
              {time(entry.at)}
            </time>
            <span aria-hidden="true" className="mr-2 text-muted-foreground">
              —
            </span>
            {entry.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const s = useWorkspace(),
    router = useRouter(),
    action = useAction();
  const error = useLoad(() => store.loadOrder(id), `order:${id}`);
  const order = s.orders.find((record) => record.id === id);
  const related = s.proposals.find((record) => record.id === order?.proposalId);
  const proposal = related?.hash === order?.proposalHash ? related : undefined;
  const thread = s.local.threads.find((record) =>
    record.proposals.includes(order?.proposalId ?? ""),
  );
  const approval = proposal?.approval;
  const approvedBy =
    approval?.status === "APPROVED" && approval.proposalHash === order?.proposalHash
      ? approval.decidedByName ||
        (approval.decidedBy === s.user?.id
          ? s.user.username
          : "an authorized organization approver")
      : null;
  const policyAuthorized =
    proposal?.decision.outcome === "ALLOW" &&
    proposal.decision.limits.autonomy === "order_within_limits";
  const source =
    thread?.source ??
    (proposal?.source === "agent"
      ? "Assistant"
      : proposal?.source === "recipe"
        ? "Recipes"
        : proposal?.source === "buyer"
          ? "Manual purchase"
          : "Purchasing service");
  const revision =
    thread && thread.proposals.length > 1 && order
      ? thread.proposals.indexOf(order.proposalId) + 1
      : undefined;
  const suppliers = [...new Set(order?.lines.map((line) => line.vendorName).filter(Boolean))];
  const mismatch = related && order && related.hash !== order.proposalHash;
  return (
    <div className="mx-auto w-full max-w-conversation space-y-6">
      <Link
        href="/orders"
        className="inline-flex min-h-11 items-center gap-2 text-label text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon name="arrow-left" className="size-4" /> Back to Orders
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 border-b pb-6">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title min-w-0 [overflow-wrap:anywhere]">
              {order ? `Order ${order.id}` : "Order details"}
            </h1>
            {order && <StatusBadge status={order.status} icon="check-circle" />}
          </div>
          {order && (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Source: {source}
              {revision ? ` (Proposal v${revision})` : ""}
              {approvedBy && <> · Approved by {approvedBy}</>}
              {policyAuthorized && !approvedBy && " · Authorized by purchasing policy"}
              <span className="mx-1" aria-hidden="true">
                ·
              </span>
              <time dateTime={order.createdAt}>
                {displayDate(order.createdAt)}, {time(order.createdAt)}
              </time>
            </p>
          )}
        </div>
        {order && (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={action.busy || (!thread && !proposal)}
              onClick={() =>
                void action.run(async () => {
                  router.push(
                    `/buyer/conversations/${thread?.id ?? store.discussPurchase(order.proposalId)}`,
                  );
                })
              }
            >
              <Icon name="workspace" className="size-4" /> Discuss in assistant
            </Button>
            <Link href={`/checkout/${id}`} className={buttonVariants()}>
              Continue to checkout <Icon name="arrow-right" className="size-4" />
            </Link>
          </div>
        )}
      </div>
      <ErrorMessage
        error={
          error ||
          action.error ||
          (mismatch
            ? "The proposal reference differs from this recorded order. The items and totals below use the frozen order record."
            : null)
        }
      />
      {order ? (
        <>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <h2 className="text-base font-semibold">
                Items in this order ({order.lines.length})
              </h2>
              {suppliers.length === 1 && (
                <p className="max-w-full text-caption text-muted-foreground [overflow-wrap:anywhere]">
                  Supplier: {suppliers[0]}
                </p>
              )}
            </div>
            <ul className="divide-y">
              {order.lines.map((line, index) => (
                <OrderItem
                  key={`${line.productId}:${index}`}
                  line={line}
                  currency={order.currency}
                  date={proposal?.pricingDate}
                  showSupplier={suppliers.length !== 1}
                />
              ))}
            </ul>
            {!order.lines.length && (
              <p className="py-6 text-sm text-muted-foreground">
                No line items were provided for this order.
              </p>
            )}
            <div
              className={`mt-1 flex items-start gap-3 rounded-md border p-4 ${approvedBy || policyAuthorized ? "border-success/15 bg-success-surface" : "bg-muted"}`}
            >
              <Icon
                name={approvedBy || policyAuthorized ? "check-circle" : "info"}
                className={`mt-0.5 size-4 shrink-0 ${approvedBy || policyAuthorized ? "text-success" : "text-muted-foreground"}`}
              />
              <div className="min-w-0 text-sm leading-6">
                <p className="font-medium">
                  {approvedBy
                    ? `Purchase approved by ${approvedBy}.`
                    : policyAuthorized
                      ? "Recorded under explicitly configured purchasing limits."
                      : "Order recorded by the purchasing service."}
                </p>
                <p className="mt-1 text-caption leading-5 text-muted-foreground">
                  Supplier dispatch, delivery reservations and payment are not connected.
                </p>
              </div>
            </div>
            <dl className="ml-auto mt-6 w-full space-y-3 border-t pt-5 text-sm sm:max-w-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Net subtotal</dt>
                <dd className="font-medium tabular-nums">
                  {eur(order.totalExclVat, order.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">VAT</dt>
                <dd className="text-muted-foreground">Not provided</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-t pt-4">
                <dt className="font-semibold">
                  Total{" "}
                  <span className="text-caption font-normal text-muted-foreground">
                    (excl. VAT)
                  </span>
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {eur(order.totalExclVat, order.currency)}
                </dd>
              </div>
            </dl>
          </Panel>
          <Panel>
            <h2 className="text-base font-semibold">Order Activity & Lifecycle</h2>
            <OrderLifecycle
              order={order}
              proposal={proposal}
              thread={thread}
              approvedBy={approvedBy}
              policyAuthorized={policyAuthorized}
            />
            <details className="group mt-6 border-t pt-3">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  View technical audit & snapshot evidence{" "}
                  <Icon
                    name="arrow-right"
                    className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                  />
                </span>
                <span className="hidden font-mono text-[11px] sm:inline" title={order.proposalHash}>
                  Ref: {order.proposalHash.slice(0, 12)}…
                </span>
              </summary>
              <div className="space-y-4 py-4 text-sm leading-6 text-muted-foreground">
                <p>
                  Creation and approval entries come from purchasing records. Initial conversation
                  activity is available only in this browser. A global audit feed is not connected.
                </p>
                <dl className="space-y-3">
                  <div>
                    <dt className="font-medium text-foreground">Frozen content reference</dt>
                    <dd className="break-all font-mono text-caption">{order.proposalHash}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Price source</dt>
                    <dd>
                      {proposal?.priceSource === "valio"
                        ? "Valio catalog lookup"
                        : proposal?.priceSource === "mock"
                          ? "Development fixture data"
                          : "Not available"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Tax information</dt>
                    <dd>
                      The purchasing record provides prices excluding VAT. A tax amount, VAT rate
                      and VAT-inclusive total were not provided.
                    </dd>
                  </div>
                </dl>
                <ul className="space-y-2">
                  {order.lines.map((line, index) => (
                    <li key={`${line.productId}:${index}`}>
                      {line.name}:{" "}
                      {line.orderable && line.availableQuantity !== null
                        ? `${line.availableQuantity} ${line.salesUnit ?? "sales units"} available at quote time; earliest delivery ${displayDate(line.availableDate)}.`
                        : "Availability was not confirmed in the quote snapshot."}{" "}
                      Stock and dates are snapshots, not reservations.
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/proposals/${order.proposalId}`}
                  className="inline-flex min-h-11 items-center gap-2 text-primary underline underline-offset-4"
                >
                  View purchase proposal <Icon name="arrow-right" className="size-4" />
                </Link>
              </div>
            </details>
          </Panel>
        </>
      ) : (
        !error && (
          <p role="status" className="py-8 text-muted-foreground">
            Loading order…
          </p>
        )
      )}
    </div>
  );
}
