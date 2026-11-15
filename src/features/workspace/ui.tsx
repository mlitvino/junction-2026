"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiClient, ApiError } from "@/client/api-client";
import { useWorkspace } from "@/client/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Icon, type IconName } from "@/components/ui/icon";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { InlineActionConfirmation } from "@/components/ui/inline-action-confirmation";
import { useAction } from "@/features/procurement/use-action";
import { BudgetComparison, SelectionTrail } from "./selection-trail";
import type {
  Proposal,
  ProposalLine,
  ProposalVerification,
  Order,
  OrderReceipt,
} from "@/shared/contracts/purchasing";
import { TradeAirlock } from "./trade-airlock";
import { AnimatedPrice } from "./animated-price";

export const store = apiClient.workspace;
export const inputClass =
  "min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";
export function eur(value: number | null | undefined, currency = "EUR") {
  return value == null
    ? "Price unavailable"
    : new Intl.NumberFormat("en-FI", { style: "currency", currency }).format(value);
}
export function displayDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Helsinki",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {error instanceof ApiError && error.status === 401 && (
        <Link href="/login" className="mt-3 inline-block underline">
          Sign in again
        </Link>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <p role="status" className="py-12 text-muted-foreground">
      Loading your workspace…
    </p>
  );
}
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="py-12 text-center">
      <Icon name="leaf" className="mx-auto mb-4 text-muted-foreground" />
      <h2 className="section-title">{title}</h2>
      <div className="mx-auto mt-3 max-w-lg text-muted-foreground">{children}</div>
    </section>
  );
}
export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const s = useWorkspace();
  if (!s.ready) return <Loading />;
  if (!s.user)
    return (
      <div className="mx-auto w-full max-w-xl py-12">
        <h1 className="page-title mb-6">Your workspace is unavailable</h1>
        <ErrorMessage error={s.error} />
        <Link href="/login" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
          Sign in
        </Link>
      </div>
    );
  return <>{children}</>;
}
export function Page({
  title,
  description,
  action,
  wide = false,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto w-full space-y-8 ${wide ? "max-w-data" : "max-w-conversation"}`}>
      <PageHeader title={title} description={description} action={action} />
      {children}
    </div>
  );
}
export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`luukku-chamber border bg-card p-4 md:p-6 ${className}`}>
      {children}
    </section>
  );
}
export function EvidenceDisclosure({
  title = "View supplier & unit evidence",
  children,
  icon = "shield-outline",
}: {
  title?: string;
  children: React.ReactNode;
  icon?: IconName;
}) {
  return (
    <details className="group/evidence rounded-lg text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
        <Icon name={icon} className="size-4 shrink-0 text-primary" />
        <span className="flex-1">{title}</span>
        <Icon
          name="chevron"
          className="size-3.5 shrink-0 transition-transform group-open/evidence:rotate-90"
        />
      </summary>
      <div className="space-y-3 border-t px-2 py-4 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
export function PriceDisplay({
  value,
  currency = "EUR",
}: {
  value: number | null | undefined;
  currency?: string;
}) {
  return (
    <span className="inline-flex flex-col text-right">
      <span className="luukku-amount text-lg tabular-nums">
        <AnimatedPrice value={value} currency={currency} />
      </span>
      <span className="text-caption text-muted-foreground">excl. VAT</span>
    </span>
  );
}
const statusLabels: Record<string, string> = {
  READY: "Ready for review",
  PENDING_APPROVAL: "Waiting for approval",
  PENDING: "Needs review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  BLOCKED: "Needs attention",
  CANCELLED: "Withdrawn",
  EXPIRED: "Expired",
  ORDERED: "Order recorded",
  SIMULATED_CONFIRMED: "Recorded",
};
export function StatusBadge({
  status,
  label,
  icon,
}: {
  status: string;
  label?: string;
  icon?: IconName;
}) {
  const tone = ["BLOCKED", "REJECTED", "EXPIRED"].includes(status)
    ? "bg-destructive/10 text-destructive"
    : ["APPROVED", "ORDERED", "SIMULATED_CONFIRMED"].includes(status)
      ? "bg-success-surface text-success"
      : ["PENDING", "PENDING_APPROVAL", "READY"].includes(status)
        ? "bg-warning-surface text-warning"
        : "bg-muted text-muted-foreground";
  return (
    <span
      key={status}
      className={`luukku-status inline-flex max-w-full items-center gap-2 px-3 py-1 ${tone}`}
    >
      {icon ? (
        <Icon name={icon} className="size-3.5 shrink-0" />
      ) : (
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
      )}
      {label ?? statusLabels[status] ?? status}
    </span>
  );
}
export function ProductLine({ line }: { line: ProposalLine }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{line.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {line.quantity} {line.salesUnit ?? "sales units"} · {line.vendorName}
        </p>
        <p className="mt-2 text-caption text-muted-foreground">
          {line.orderable && line.availableQuantity !== null
            ? `Snapshot availability: ${line.availableQuantity} ${line.salesUnit ?? "units"} · ${displayDate(line.availableDate)}`
            : "Availability not confirmed"}
        </p>
      </div>
      <PriceDisplay value={line.lineTotalExclVat} />
    </div>
  );
}
export function ReceiptPanel({ receipt }: { receipt: OrderReceipt }) {
  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="section-title">Order receipt</h2>
          <p className="mt-1 text-caption text-muted-foreground">
            Order {receipt.orderId} · Issued {displayDate(receipt.issuedAt)}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          Print receipt
        </Button>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 md:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Organization</dt>
          <dd className="mt-1 font-medium">{receipt.organizationName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ordered by</dt>
          <dd className="mt-1 font-medium">{receipt.orderedByName ?? "Buyer"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Approved by</dt>
          <dd className="mt-1 font-medium">
            {receipt.approvedByName ?? "Explicit purchasing policy"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Delivery date</dt>
          <dd className="mt-1 font-medium">{displayDate(receipt.deliveryDate)}</dd>
        </div>
      </dl>
      <div className="divide-y border-t pt-2 text-sm">
        {receipt.lines.map((line) => (
          <div
            key={line.productId}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
          >
            <div>
              <p className="font-medium">{line.name}</p>
              <p className="text-caption text-muted-foreground">
                {line.quantity} {line.salesUnit ?? "units"} ×{" "}
                {eur(line.unitPriceExclVat, receipt.currency)} · {line.vendorName}
              </p>
            </div>
            <span className="font-medium tabular-nums">
              {eur(line.lineTotalExclVat, receipt.currency)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <span className="font-medium">Total (excl. VAT)</span>
        <PriceDisplay value={receipt.totalExclVat} currency={receipt.currency} />
      </div>
      <p className="break-all text-caption text-muted-foreground">
        Proposal {receipt.proposalId} · Hash {receipt.proposalHash}
        {receipt.proposalSignature ? ` · Signed (${receipt.signatureKeyId ?? "server"})` : ""}
      </p>
    </Panel>
  );
}

export function OrderSummary({ order }: { order: Order }) {
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="section-title">Order recorded</h2>
          <p className="mt-2 text-caption text-muted-foreground">{order.id}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="divide-y">
        {order.lines.map((line) => (
          <ProductLine key={line.productId} line={line} />
        ))}
      </div>
      <div className="mt-4 flex justify-between border-t pt-4">
        <span>Total</span>
        <PriceDisplay value={order.totalExclVat} />
      </div>
    </Panel>
  );
}

export function ProductComparison({
  proposal,
  threadId,
  compact = false,
  canRevise = false,
  onRevised,
}: {
  proposal: Proposal;
  threadId?: string;
  compact?: boolean;
  canRevise?: boolean;
  onRevised?: (revised: Proposal) => void;
}) {
  const [rowsState, setRowsState] = useState<{
    proposalId: string;
    rows: {
      id: string;
      name: string;
      unit: string;
      price: number | null;
      confirmed: boolean;
      tier?: string | null;
      reasons?: string[];
    }[];
    loaded: boolean;
  }>({ proposalId: proposal.id, rows: [], loaded: false });
  const [selectedLineState, setSelectedLineState] = useState<{
    proposalId: string;
    lineId: string;
  }>({ proposalId: proposal.id, lineId: proposal.lines[0]?.productId ?? "" });
  const action = useAction();

  const rows = rowsState.proposalId === proposal.id ? rowsState.rows : [];
  const loaded = rowsState.proposalId === proposal.id ? rowsState.loaded : false;
  const selectedLineId =
    selectedLineState.proposalId === proposal.id
      ? selectedLineState.lineId
      : (proposal.lines[0]?.productId ?? "");

  const activeLine =
    proposal.lines.find((l) => l.productId === selectedLineId) ?? proposal.lines[0];
  const currentLineIds = new Set(proposal.lines.map((l) => l.productId));
  const visibleRows = rows.filter((row) => !currentLineIds.has(row.id));

  async function loadAlternatives(line: Proposal["lines"][number] | undefined) {
    const query = line?.name.split(" ")[0] ?? "";
    if (!store.mock && query) {
      const ranked = await store.api.rankProducts({
        q: query,
        quantity: line?.quantity ?? 1,
        date: proposal.pricingDate,
        limit: 6,
      });
      const alt = ranked.ranked
        .filter((r) => !proposal.lines.some((l) => l.productId === r.product.id))
        .slice(0, 3);
      if (alt.length) {
        setRowsState({
          proposalId: proposal.id,
          rows: alt.map((r) => ({
            id: r.product.id,
            name: r.product.name,
            unit: r.salesUnit,
            price: r.unitPriceExclVat,
            confirmed: r.availableQuantity !== null,
            tier: r.tier,
            reasons: r.reasons,
          })),
          loaded: true,
        });
        return;
      }
    }
    const products = (await store.api.searchProducts(query)).items
      .filter((p) => !proposal.lines.some((l) => l.productId === p.id))
      .slice(0, 3);
    const offers = products.length
      ? await store.api.getOffers(
          products.map((p) => p.id),
          proposal.pricingDate,
        )
      : null;
    setRowsState({
      proposalId: proposal.id,
      rows: products.map((product) => {
        const offer = offers?.offers.find((o) => o.productId === product.id);
        return {
          id: product.id,
          name: product.name,
          unit: product.salesUnit,
          price: offer?.price?.priceExclVat ?? null,
          confirmed:
            !!offer?.availability?.orderable && offer.availability.availableQuantity !== null,
        };
      }),
      loaded: true,
    });
  }

  return (
    <details
      className="group/comparison rounded-lg"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded)
          void action.run(() => loadAlternatives(activeLine));
      }}
    >
      <summary
        className={
          compact
            ? "flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            : "min-h-11 py-3 text-sm"
        }
      >
        {compact && <Icon name="compare" className="size-4 shrink-0" />}
        <span className="flex-1">Compare alternatives</span>
        {compact && (
          <Icon
            name="chevron"
            className="size-3.5 transition-transform group-open/comparison:rotate-90"
          />
        )}
      </summary>
      <div className="space-y-4 border-t py-4">
        <ErrorMessage error={action.error} />
        {proposal.lines.length > 1 && (
          <label className="block text-label">
            Line to compare &amp; swap
            <select
              className={`${inputClass} mt-1.5`}
              value={activeLine?.productId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedLineState({ proposalId: proposal.id, lineId: nextId });
                setRowsState({ proposalId: proposal.id, rows: [], loaded: false });
                const nextLine = proposal.lines.find((l) => l.productId === nextId);
                void action.run(() => loadAlternatives(nextLine));
              }}
            >
              {proposal.lines.map((line) => (
                <option key={line.productId} value={line.productId}>
                  {line.name} ({line.quantity} {line.salesUnit ?? "units"})
                </option>
              ))}
            </select>
          </label>
        )}
        {action.busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking a shortlist of alternatives…
          </p>
        ) : visibleRows.length ? (
          visibleRows.map((row) => (
            <div className="flex flex-wrap justify-between gap-3 border-b pb-4" key={row.id}>
              <div>
                <h3 className="text-sm font-medium">
                  {row.tier ? `${row.tier.toUpperCase()} · ` : ""}
                  {row.name}
                </h3>
                <p className="mt-2 text-caption text-muted-foreground">
                  Per {row.unit} ·{" "}
                  {row.confirmed
                    ? "Available in the current snapshot"
                    : "Availability not confirmed"}
                </p>
                {row.reasons && row.reasons.length > 0 && (
                  <p className="mt-1 text-caption text-muted-foreground">
                    {row.reasons.join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <PriceDisplay value={row.price} />
                {canRevise && activeLine && row.id !== activeLine.productId && (
                  <Button
                    variant="outline"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const revised = await store.reviseProposal(
                          proposal.id,
                          {
                            replacements: [
                              { fromProductId: activeLine.productId, toProductId: row.id },
                            ],
                          },
                          threadId,
                        );
                        onRevised?.(revised.proposal);
                      })
                    }
                  >
                    Swap to this
                  </Button>
                )}
              </div>
            </div>
          ))
        ) : (
          loaded && (
            <p className="text-sm text-muted-foreground">
              No alternative was returned for this search. You can refine the search in the product
              picker.
            </p>
          )
        )}
        <p className="text-caption text-muted-foreground">
          {store.mock
            ? "These are comparison candidates, not verified substitutes. Confirm packaging and dietary requirements before preparing a new proposal."
            : "Ranked candidates exclude allergens, dietary restrictions, blocked vendors, and products exceeding CO2 or delivery-reliability limits from your organization policy."}
        </p>
        <Link href="/buyer/products" className={buttonVariants({ variant: "outline" })}>
          Choose products & review quantities
        </Link>
      </div>
    </details>
  );
}

function ReviewPurchaseSummary({
  proposal,
  threadId,
  stale,
  canDecide,
}: {
  proposal: Proposal;
  threadId?: string;
  stale: boolean;
  canDecide: boolean;
}) {
  const s = useWorkspace();
  const thread = s.local.threads.find((t) => t.id === threadId);
  const version = thread ? thread.proposals.indexOf(proposal.id) + 1 : null;
  const first = proposal.lines[0];
  const source =
    thread?.source ??
    (proposal.source === "agent"
      ? "Assistant"
      : proposal.source === "recipe"
        ? "Recipes"
        : "Manual");
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${proposal.pricingDate}T12:00:00Z`));
  const attention = proposal.decision.reasons.some(
    (r) =>
      r.outcome === "DENY" ||
      ["LATE_DELIVERY", "INSUFFICIENT_STOCK", "AVAILABILITY_UNKNOWN"].includes(r.code),
  );
  return (
    <>
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Purchase proposal{version ? ` · Proposal v${version}` : ""}</span>
            <span className="rounded bg-muted px-2 py-0.5 font-mono" title={proposal.id}>
              {proposal.id.slice(0, 8)}
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5">
              <Icon
                name={
                  source === "Restocking"
                    ? "restocking"
                    : source === "Recipes"
                      ? "recipes"
                      : "workspace"
                }
                className="size-3"
              />
              {source}
            </span>
          </div>
          <StatusBadge
            status={proposal.status}
            icon="clock"
            label={
              stale && !["ORDERED", "CANCELLED", "REJECTED", "EXPIRED"].includes(proposal.status)
                ? "Quote expired"
                : canDecide
                  ? "Awaiting approval"
                  : undefined
            }
          />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
            {first?.name ?? "Purchase request"}
            {first ? ` (${first.quantity} ${first.salesUnit ?? "sales units"})` : ""}
            {proposal.lines.length > 1 ? ` + ${proposal.lines.length - 1} more` : ""}
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Requested by{" "}
            <span className="font-medium text-foreground">
              {proposal.approval?.requestedByName ??
                proposal.createdByName ??
                "organization member"}
            </span>{" "}
            · Needed{" "}
            <time className="text-foreground" dateTime={proposal.pricingDate}>
              {date}
            </time>
          </p>
        </div>
      </Panel>
      <TradeAirlock key={proposal.id} proposal={proposal} />
      <Panel className="space-y-5">
        <div className="flex items-center justify-between gap-3 border-b pb-4">
          <h2 className="text-sm font-semibold">
            Items in this proposal ({proposal.lines.length})
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {proposal.lines.length} {proposal.lines.length === 1 ? "line" : "lines"}
          </span>
        </div>
        <ul className="space-y-3">
          {proposal.lines.map((line, index) => (
            <li
              key={`${line.productId}-${index}`}
              className="flex flex-wrap items-start gap-3 rounded-lg border p-4"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                <Icon name="restocking" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{line.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {line.quantity} {line.salesUnit ?? "sales units"}
                  {line.vendorName ? ` · ${line.vendorName}` : ""}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Valio Aimo SKU: <span className="font-mono">{line.productId}</span>
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[11px] text-muted-foreground">
                  Unit price {eur(line.unitPriceExclVat, proposal.currency)} /{" "}
                  {line.salesUnit ?? "sales unit"}
                </p>
                <p className="mt-1 text-base font-semibold tabular-nums">
                  {eur(line.lineTotalExclVat, proposal.currency)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div
          className={`space-y-2 rounded-lg border p-4 text-xs leading-relaxed ${attention ? "border-warning/20 bg-warning-surface/40" : "bg-muted/40"}`}
        >
          {proposal.lines.map((line, index) => {
            const confirmed =
              line.orderable === true &&
              line.availableQuantity !== null &&
              line.availableQuantity >= line.quantity &&
              line.availableDate !== null &&
              line.availableDate.slice(0, 10) <= proposal.pricingDate;
            return (
              <p
                key={`${line.productId}-${index}`}
                className={`flex items-start gap-2 ${confirmed ? "text-primary" : "text-warning"}`}
              >
                <Icon
                  name={confirmed ? "check-circle" : "info"}
                  className="mt-0.5 size-3.5 shrink-0"
                />
                <span>
                  {proposal.lines.length > 1 ? `${line.name}: ` : ""}
                  {confirmed
                    ? "Availability confirmed for the requested delivery date"
                    : line.availableDate
                      ? `Earliest delivery ${displayDate(line.availableDate)}. ${line.availableQuantity === null ? "Available quantity not confirmed." : `${line.availableQuantity} ${line.salesUnit ?? "sales units"} available in the quoted snapshot.`}`
                      : "Availability needs confirmation"}
                </span>
              </p>
            );
          })}
          {proposal.decision.reasons.some((r) =>
            ["SUGGEST_ONLY", "NO_AUTO_APPROVAL"].includes(r.code),
          ) && (
            <p className="flex items-start gap-2 text-muted-foreground">
              <Icon name="shield-outline" className="mt-0.5 size-3.5 shrink-0" />
              <span>Human approval required by purchasing policy.</span>
            </p>
          )}
          {proposal.decision.reasons.some((r) => r.outcome === "DENY") && (
            <p className="flex items-start gap-2 text-destructive">
              <Icon name="info" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Some purchasing conditions need attention. Review the evidence below before
                deciding.
              </span>
            </p>
          )}
        </div>
        <dl className="border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm font-semibold">
              Total{" "}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                (excl. VAT)
              </span>
            </dt>
            <dd className="luukku-amount text-xl tabular-nums">
              <AnimatedPrice value={proposal.totalExclVat} currency={proposal.currency} />
            </dd>
          </div>
        </dl>
        <EvidenceDisclosure>
          <ul className="list-disc space-y-2 pl-4">
            {proposal.decision.reasons.map((r, index) => (
              <li key={`${r.code}-${index}`}>{r.message}</li>
            ))}
          </ul>
          <p>
            Prices exclude VAT. A VAT-inclusive total is not supplied by this purchasing snapshot.
          </p>
          <p>
            Fixed prices valid until{" "}
            {proposal.quoteExpiresAt
              ? new Date(proposal.quoteExpiresAt).toLocaleString("en-GB", {
                  timeZone: "Europe/Helsinki",
                })
              : "not supplied"}{" "}
            (Helsinki).
          </p>
          <p>
            Source:{" "}
            {proposal.priceSource === "valio" ? "Valio catalog lookup" : "Development fixture data"}
            . Availability is a snapshot, not a reserved delivery slot.
          </p>
          <p className="break-all">
            Proposal {proposal.id} · Content reference {proposal.hash}
          </p>
          <ProductComparison proposal={proposal} />
        </EvidenceDisclosure>
      </Panel>
    </>
  );
}

function ProposalItems({ proposal }: { proposal: Proposal }) {
  return (
    <section aria-label="Items in this proposal" className="space-y-4">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <h3 className="text-sm font-semibold">Items in this proposal ({proposal.lines.length})</h3>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {proposal.lines.length} {proposal.lines.length === 1 ? "line" : "lines"}
        </span>
      </div>
      <ul className="space-y-3">
        {proposal.lines.map((line, index) => {
          const confirmed =
            line.orderable === true &&
            line.availableQuantity !== null &&
            line.availableQuantity >= line.quantity &&
            line.availableDate !== null &&
            line.availableDate.slice(0, 10) <= proposal.pricingDate;
          return (
            <li
              key={`${line.productId}-${index}`}
              className="rounded-xl border bg-muted/10 p-4 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-accent/50 text-primary">
                  <Icon name="restocking" className="size-5" />
                </span>
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5">
                  <div className="min-w-0">
                    <h4 className="break-words text-sm font-semibold leading-relaxed">
                      {line.name}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {line.quantity} {line.salesUnit ?? "sales units"}
                      </span>
                      {line.vendorName ? ` · ${line.vendorName}` : ""}
                    </p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Valio Aimo SKU:{" "}
                      <span className="font-mono text-primary">{line.productId}</span>
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-[10px] text-muted-foreground">
                      Unit price {eur(line.unitPriceExclVat, proposal.currency)} /{" "}
                      {line.salesUnit ?? "sales unit"}
                    </p>
                    <p className="luukku-amount mt-1 text-base tabular-nums">
                      <AnimatedPrice value={line.lineTotalExclVat} currency={proposal.currency} />
                    </p>
                  </div>
                </div>
              </div>
              <p
                className={`mt-3 flex items-start gap-2 border-t pt-3 text-xs leading-relaxed ${confirmed ? "text-success" : "text-muted-foreground"}`}
              >
                <Icon
                  name={confirmed ? "check-circle" : "truck"}
                  className="mt-0.5 size-3.5 shrink-0"
                />
                <span>
                  Needed {displayDate(proposal.pricingDate)} ·{" "}
                  {confirmed
                    ? "Availability confirmed in the quoted snapshot"
                    : "Availability needs confirmation"}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ApprovalCard({
  proposal,
  threadId,
  compact = false,
  onReview,
  onCheckout,
  onRevised,
  reviewLayout = false,
  inlineActions = false,
}: {
  proposal: Proposal;
  threadId?: string;
  compact?: boolean;
  onReview?: () => void;
  onCheckout?: () => void;
  onRevised?: (revised: Proposal) => void;
  reviewLayout?: boolean;
  inlineActions?: boolean;
}) {
  const s = useWorkspace();
  const Confirmation = inlineActions ? InlineActionConfirmation : ActionConfirmation;
  const router = useRouter();
  const action = useAction();
  const [reasonState, setReasonState] = useState<{ proposalId: string; text: string }>({
    proposalId: proposal.id,
    text: "",
  });
  const [verificationState, setVerificationState] = useState<{
    proposalId: string;
    data: ProposalVerification | null;
  }>({ proposalId: proposal.id, data: null });
  const reason = reasonState.proposalId === proposal.id ? reasonState.text : "";
  const setReason = (text: string) => setReasonState({ proposalId: proposal.id, text });
  const verification = verificationState.proposalId === proposal.id ? verificationState.data : null;
  const setVerification = (data: ProposalVerification | null) =>
    setVerificationState({ proposalId: proposal.id, data });
  const buyer = s.user?.roles.includes("buyer"),
    approver = s.user?.roles.includes("approver");
  const owner = proposal.createdBy === s.user?.id;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const expired = !!proposal.quoteExpiresAt && Date.parse(proposal.quoteExpiresAt) <= clock;
  const stale = s.local.stale.includes(proposal.id) || expired;
  const confirmedSupply = proposal.lines.every(
    (line) =>
      line.orderable &&
      line.availableQuantity !== null &&
      line.availableQuantity >= line.quantity &&
      line.availableDate !== null &&
      line.availableDate.slice(0, 10) <= proposal.pricingDate,
  );
  const revision = threadId
    ? s.local.threads.find((t) => t.id === threadId)?.proposals.indexOf(proposal.id)
    : undefined;
  const superseded = proposal.status === "CANCELLED" && !!threadId;
  const canRevise =
    !!buyer &&
    owner &&
    ["READY", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status) &&
    !stale;
  const canDecide =
    approver &&
    proposal.status === "PENDING_APPROVAL" &&
    proposal.approval?.status === "PENDING" &&
    !stale;
  const notices = [
    ...(proposal.status === "BLOCKED"
      ? [{ text: proposal.decision.reasons.map((r) => r.message).join(" "), tone: "destructive" }]
      : []),
    ...(proposal.approval?.status === "REJECTED"
      ? [
          {
            text: `Reason: ${proposal.approval.comment ?? "The purchase was declined."} You can revise this request in the Assistant.`,
            tone: "destructive",
          },
        ]
      : []),
    ...(proposal.lines.some(
      (line) =>
        !line.orderable ||
        line.availableQuantity === null ||
        line.availableQuantity < line.quantity,
    )
      ? [
          {
            text:
              proposal.status === "ORDERED"
                ? "Quoted availability or quantity was not fully confirmed."
                : "Some availability or quantity conditions need attention. Review them before deciding.",
            tone: "warning",
          },
        ]
      : []),
    ...(proposal.status === "READY" && proposal.decision.outcome === "ALLOW" && !confirmedSupply
      ? [
          {
            text: "Autonomous ordering is paused because supply is not confirmed. Ask an Approver to require human review in purchasing policies, then prepare a fresh proposal, or choose a product with confirmed supply.",
            tone: "warning",
          },
        ]
      : []),
    ...(proposal.selection?.warnings.map((text) => ({ text, tone: "warning" })) ?? []),
  ];
  async function approve() {
    await store.approve(proposal.id, "APPROVED", reason);
    if (buyer && onCheckout) onCheckout();
    else if (buyer) await store.placeOrder(proposal.id);
  }
  return (
    <div className="luukku-purchase space-y-4">
      {reviewLayout && (
        <ReviewPurchaseSummary
          proposal={proposal}
          threadId={threadId}
          stale={stale}
          canDecide={!!canDecide}
        />
      )}
      <section
        aria-label={!reviewLayout ? "Purchase proposal" : undefined}
        className={
          reviewLayout
            ? "space-y-4 rounded-lg border bg-card p-4 md:p-6"
            : "overflow-hidden rounded-2xl border bg-card"
        }
      >
        {!reviewLayout && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">Purchase proposal</h2>
                {revision !== undefined && revision >= 0 && (
                  <span className="rounded bg-muted px-2 py-1 text-caption text-muted-foreground">
                    Proposal v{revision + 1}
                  </span>
                )}
              </div>
              <StatusBadge
                status={proposal.status}
                icon={
                  ["APPROVED", "ORDERED"].includes(proposal.status)
                    ? "check-circle"
                    : ["BLOCKED", "REJECTED"].includes(proposal.status)
                      ? "info"
                      : "clock"
                }
                label={
                  superseded
                    ? "Superseded — no longer actionable"
                    : stale &&
                        !["ORDERED", "CANCELLED", "REJECTED", "EXPIRED"].includes(proposal.status)
                      ? "Prices need refreshing"
                      : canDecide
                        ? "Ready for review · Awaiting approval"
                        : undefined
                }
              />
            </div>
            <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
              <ProposalItems proposal={proposal} />
              {notices.length > 0 && (
                <div
                  className={`space-y-2 rounded-xl border p-4 ${proposal.status === "BLOCKED" ? "border-destructive/20 bg-destructive/5" : "border-warning/20 bg-warning-surface/40"}`}
                >
                  {notices.map((notice, index) => (
                    <p
                      key={index}
                      className={`flex items-start gap-2.5 text-xs leading-relaxed ${notice.tone === "destructive" ? "text-destructive" : "text-warning"}`}
                    >
                      <Icon name="info" className="mt-0.5 size-4 shrink-0" />
                      <span>{notice.text}</span>
                    </p>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-4 border-t pt-4">
                <div>
                  <p className="text-sm font-semibold">Net total</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    VAT-inclusive total is not supplied
                  </p>
                </div>
                <PriceDisplay value={proposal.totalExclVat} currency={proposal.currency} />
              </div>
              <div className="space-y-2 border-t pt-3">
                <EvidenceDisclosure title="Budget & policy check" icon="shield-outline">
                  <BudgetComparison proposal={proposal} />
                </EvidenceDisclosure>

                <SelectionTrail
                  key={`trail-${proposal.id}`}
                  proposal={proposal}
                  threadId={threadId}
                  compact
                  canRevise={canRevise}
                  onRevised={onRevised}
                />
                <ProductComparison
                  key={proposal.id}
                  proposal={proposal}
                  threadId={threadId}
                  compact
                  canRevise={canRevise}
                  onRevised={onRevised}
                />
                <EvidenceDisclosure title="Purchasing conditions & evidence">
                  <p>{proposal.decision.reasons.map((r) => r.message).join(" ")}</p>
                  <p>
                    Policy limits are excluding VAT. A VAT-inclusive total is not provided by this
                    purchasing snapshot.
                  </p>
                  <p>
                    Fixed prices valid until{" "}
                    {proposal.quoteExpiresAt
                      ? new Date(proposal.quoteExpiresAt).toLocaleString("en-GB", {
                          timeZone: "Europe/Helsinki",
                        })
                      : "not supplied"}{" "}
                    (Helsinki).
                  </p>
                  <p>
                    Source:{" "}
                    {proposal.priceSource === "valio"
                      ? "Valio catalog lookup"
                      : "Development fixture data"}
                    . Availability is a snapshot, not a reserved delivery slot.
                  </p>
                  <p className="break-all text-caption">
                    Proposal: {proposal.id} · Content reference: {proposal.hash}
                  </p>
                  {proposal.selection && proposal.selection.pipeline.length > 0 && (
                    <div className="space-y-2 border-t pt-3">
                      <p className="font-medium text-foreground">Agent selection trail</p>
                      {proposal.selection.pipeline.map((step, index) => (
                        <p key={index}>
                          {step.extractedItem.productName} ({step.parsedQuantity} {step.parsedUnit}
                          {step.conversionNote ? ` · ${step.conversionNote}` : ""}):{" "}
                          {step.selectedProduct
                            ? `Selected ${step.selectedProduct.name} (${step.selectedProduct.rankReasons?.join(", ") || "best match"}).`
                            : "No matching product selected."}{" "}
                          {step.removedByPreferences.length > 0
                            ? `${step.removedByPreferences.length} candidate(s) excluded by rules.`
                            : ""}
                        </p>
                      ))}
                    </div>
                  )}
                  {!store.mock && (
                    <div className="space-y-2 border-t pt-3">
                      <Button
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            setVerification(await store.api.verifyProposal(proposal.id));
                          })
                        }
                      >
                        Verify hash &amp; Valio snapshots
                      </Button>
                      {verification && (
                        <p className="text-caption">
                          Hash valid: {verification.hashValid ? "Yes" : "No"} · Signature valid:{" "}
                          {verification.signatureValid === null ||
                          verification.signatureValid === undefined
                            ? "Unsigned"
                            : verification.signatureValid
                              ? `Yes (${verification.signatureKeyId ?? "server"})`
                              : "No"}{" "}
                          · Snapshots matched:{" "}
                          {verification.lines.filter((l) => l.snapshotFound).length}/
                          {verification.lines.length}
                        </p>
                      )}
                    </div>
                  )}
                </EvidenceDisclosure>
              </div>
            </div>
          </>
        )}
        {reviewLayout && (
          <>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Approval decision
            </h2>
            {canDecide ? (
              <label className="block">
                <span className="sr-only">Decision note (required when rejecting)</span>
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  maxLength={1000}
                  placeholder="Add a note, or enter a reason if rejecting?"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            ) : (
              <p className="text-sm text-muted-foreground">
                {stale
                  ? "This quote has expired. Prepare an updated proposal before making a decision."
                  : (proposal.approval?.comment ??
                    "No decision is currently required from your account.")}
              </p>
            )}
          </>
        )}
        <ErrorMessage error={action.error} />
        <div
          className={
            reviewLayout
              ? "flex flex-wrap items-center gap-3"
              : "flex flex-wrap items-center justify-end gap-3 border-t bg-muted/20 px-4 py-4 md:px-6"
          }
        >
          {!reviewLayout && (
            <p className="mr-auto flex w-full items-center gap-2 text-caption text-muted-foreground xl:w-auto">
              <Icon name="lock" className="size-4 shrink-0" />
              {proposal.status === "ORDERED"
                ? "Order recorded"
                : proposal.status === "PENDING_APPROVAL" ||
                    (proposal.status === "READY" &&
                      proposal.decision.outcome === "REQUIRE_APPROVAL")
                  ? "Approval required before purchasing"
                  : "Decisions apply to this exact proposal"}
            </p>
          )}
          {reviewLayout && (
            <Button
              variant="ghost"
              className="mr-auto gap-2 px-0 text-xs text-primary"
              onClick={() =>
                router.push(
                  `/buyer/conversations/${threadId ?? store.discussPurchase(proposal.id)}`,
                )
              }
            >
              <Icon name="workspace" className="size-4" />
              Ask assistant for changes
            </Button>
          )}
          {canDecide && (
            <Confirmation
              title="Reject purchase?"
              description="Add a reason so the buyer can revise the request."
              trigger="Reject"
              confirmLabel="Reject purchase"
              destructive
              onConfirm={() => store.approve(proposal.id, "REJECTED", reason).then(() => {})}
            >
              <label className="block text-label">
                Reason for rejection
                <textarea
                  className={`${inputClass} mt-2 min-h-24`}
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </Confirmation>
          )}
          {buyer &&
            (!inlineActions || proposal.status !== "APPROVED") &&
            !stale &&
            (proposal.status === "APPROVED" ||
              (proposal.status === "READY" &&
                confirmedSupply &&
                proposal.decision.outcome === "ALLOW" &&
                proposal.decision.limits.autonomy === "order_within_limits")) &&
            (onCheckout ? (
              <Button onClick={onCheckout}>
                Checkout
                <Icon name="arrow-right" className="size-4" />
              </Button>
            ) : (
              <Confirmation
                title="Record this order?"
                holdToConfirm
                description="The service will recheck the fixed prices and availability. Supplier dispatch and payment are not connected."
                trigger="Record order"
                confirmLabel="Record order"
                onConfirm={() => store.placeOrder(proposal.id).then(() => {})}
              />
            ))}
          {buyer && owner && stale && !["ORDERED", "CANCELLED"].includes(proposal.status) && (
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(() =>
                  store
                    .createPurchase(
                      {
                        lines: proposal.lines.map((l) => ({
                          productId: l.productId,
                          quantity: l.quantity,
                        })),
                        date: proposal.pricingDate,
                      },
                      threadId,
                      "Assistant",
                      proposal.id,
                    )
                    .then((result) => {
                      if (!threadId) router.push(`/buyer/conversations/${result.threadId}`);
                    }),
                )
              }
            >
              Refresh prices & prepare updated proposal
            </Button>
          )}
          {buyer &&
            owner &&
            proposal.status === "READY" &&
            proposal.decision.outcome === "REQUIRE_APPROVAL" &&
            !stale && (
              <Button
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await store.api.requestApproval(proposal.id);
                    await store.refresh();
                  })
                }
              >
                Send for review
              </Button>
            )}
          {proposal.orderId &&
            !inlineActions &&
            (onCheckout ? (
              <Button onClick={onCheckout}>
                Checkout
                <Icon name="arrow-right" className="size-4" />
              </Button>
            ) : (
              <Link className={buttonVariants()} href={`/orders/${proposal.orderId}`}>
                View order
              </Link>
            ))}
          {threadId && !compact && !reviewLayout && (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/buyer/conversations/${threadId}`}
            >
              Discuss in assistant
            </Link>
          )}
          {buyer &&
            owner &&
            !inlineActions &&
            ["READY", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status) && (
              <Confirmation
                title="Withdraw this request?"
                description="This purchase and its pending review will no longer be actionable."
                trigger="Withdraw request"
                confirmLabel="Withdraw"
                destructive
                onConfirm={() => store.cancel(proposal.id)}
              />
            )}
          {canDecide &&
            (onReview ? (
              <Button onClick={onReview}>
                <Icon name="check-circle" className="size-4" />
                Approve proposal
              </Button>
            ) : (
              <Confirmation
                title="Approve this proposal?"
                holdToConfirm
                description={
                  buyer && !onCheckout
                    ? "Approve the exact purchase shown and record its order after the pricing and availability checks."
                    : buyer
                      ? "Approve this proposal, then continue to checkout."
                      : "Approve this proposal so a buyer can continue to checkout."
                }
                trigger="Approve proposal"
                triggerIcon={!reviewLayout ? "check-circle" : undefined}
                confirmLabel="Approve"
                onConfirm={approve}
              />
            ))}
        </div>
        {proposal.status === "PENDING_APPROVAL" && !approver && (
          <p
            className={`text-caption text-muted-foreground ${reviewLayout ? "" : "px-4 pb-4 md:px-6"}`}
          >
            Waiting for another authorized approver. You can still discuss changes in the Assistant.
          </p>
        )}
        {reviewLayout && (
          <p className="flex items-start gap-2 border-t pt-4 text-[11px] leading-relaxed text-muted-foreground">
            <Icon name="shield-outline" className="size-3.5 shrink-0" />
            Decisions apply to this exact proposal. Ordering rechecks prices and availability.
          </p>
        )}
      </section>
    </div>
  );
}

export function BasketReviewDrawer({
  proposal,
  threadId,
  onClose,
  onCheckout,
  children,
}: {
  proposal: Proposal;
  threadId?: string;
  onClose: () => void;
  onCheckout?: () => void;
  children?: React.ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <aside aria-label={children ? "Checkout" : "Review order"} className="review-drawer">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="section-title">{children ? "Checkout" : "Review order"}</h2>
        <Button
          ref={close}
          variant="ghost"
          size="icon"
          aria-label={children ? "Close checkout" : "Close order review"}
          onClick={onClose}
        >
          <Icon name="close" />
        </Button>
      </div>
      {children ?? (
        <ApprovalCard
          key={proposal.id}
          proposal={proposal}
          threadId={threadId}
          onCheckout={onCheckout}
        />
      )}
    </aside>
  );
}
