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
import { useAction } from "@/features/procurement/use-action";
import type { Proposal, ProposalLine, Order } from "@/shared/contracts/purchasing";

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
    <section className={`rounded-lg border bg-card p-4 md:p-6 ${className}`}>{children}</section>
  );
}
export function EvidenceDisclosure({
  title = "View supplier & unit evidence",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="text-sm">
      <summary className="min-h-11 py-3 text-muted-foreground">{title}</summary>
      <div className="space-y-3 border-t py-4 text-muted-foreground">{children}</div>
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
      <span className="text-lg font-semibold tabular-nums">{eur(value, currency)}</span>
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
  const tone = ["BLOCKED", "REJECTED"].includes(status)
    ? "bg-destructive/10 text-destructive"
    : ["APPROVED", "ORDERED", "SIMULATED_CONFIRMED"].includes(status)
      ? "bg-success-surface text-success"
      : ["PENDING", "PENDING_APPROVAL", "READY"].includes(status)
        ? "bg-warning-surface text-warning"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-caption font-medium ${tone}`}
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

export function ProductComparison({ proposal }: { proposal: Proposal }) {
  const [rows, setRows] = useState<
    { id: string; name: string; unit: string; price: number | null; confirmed: boolean }[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const action = useAction();
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded)
          void action.run(async () => {
            const query = proposal.lines[0]?.name.split(" ")[0] ?? "";
            const products = (await store.api.searchProducts(query)).items
              .filter((p) => !proposal.lines.some((l) => l.productId === p.id))
              .slice(0, 3);
            const offers = products.length
              ? await store.api.getOffers(
                  products.map((p) => p.id),
                  proposal.pricingDate,
                )
              : null;
            setRows(
              products.map((product) => {
                const offer = offers?.offers.find((o) => o.productId === product.id);
                return {
                  id: product.id,
                  name: product.name,
                  unit: product.salesUnit,
                  price: offer?.price?.priceExclVat ?? null,
                  confirmed:
                    !!offer?.availability?.orderable &&
                    offer.availability.availableQuantity !== null,
                };
              }),
            );
            setLoaded(true);
          });
      }}
    >
      <summary className="min-h-11 py-3 text-sm">Compare alternatives</summary>
      <div className="space-y-4 border-t py-4">
        <ErrorMessage error={action.error} />
        {action.busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking a shortlist of alternatives…
          </p>
        ) : rows.length ? (
          rows.map((row) => (
            <div className="flex flex-wrap justify-between gap-3 border-b pb-4" key={row.id}>
              <div>
                <h3 className="text-sm font-medium">{row.name}</h3>
                <p className="mt-2 text-caption text-muted-foreground">
                  Per {row.unit} ·{" "}
                  {row.confirmed
                    ? "Available in the current snapshot"
                    : "Availability not confirmed"}
                </p>
              </div>
              <PriceDisplay value={row.price} />
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
          These are comparison candidates, not verified substitutes. Confirm packaging and dietary
          requirements before preparing a new proposal.
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
      <Panel className="rounded-xl space-y-4">
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
      <Panel className="rounded-xl space-y-5">
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
            <dd className="text-xl font-semibold tabular-nums">
              {eur(proposal.totalExclVat, proposal.currency)}
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

export function ApprovalCard({
  proposal,
  threadId,
  compact = false,
  onReview,
  reviewLayout = false,
}: {
  proposal: Proposal;
  threadId?: string;
  compact?: boolean;
  onReview?: () => void;
  reviewLayout?: boolean;
}) {
  const s = useWorkspace();
  const router = useRouter();
  const action = useAction();
  const [reason, setReason] = useState("");
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
  const canDecide =
    approver &&
    proposal.status === "PENDING_APPROVAL" &&
    proposal.approval?.status === "PENDING" &&
    !stale;
  async function approve() {
    await store.approve(proposal.id, "APPROVED", reason);
    if (buyer) await store.placeOrder(proposal.id);
  }
  return (
    <div className="space-y-4">
      {reviewLayout && (
        <ReviewPurchaseSummary
          proposal={proposal}
          threadId={threadId}
          stale={stale}
          canDecide={!!canDecide}
        />
      )}
      <Panel className="space-y-4">
        {!reviewLayout && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  Purchase proposal
                  {revision !== undefined && revision >= 0 ? ` · v${revision + 1}` : ""}
                </h2>
                <p className="mt-1 text-caption text-muted-foreground">
                  {proposal.approval
                    ? `Review ${proposal.approval.id}`
                    : "Prepared for your kitchen"}
                </p>
              </div>
              <StatusBadge
                status={proposal.status}
                label={
                  superseded
                    ? "Superseded — no longer actionable"
                    : stale && !["ORDERED", "CANCELLED", "REJECTED"].includes(proposal.status)
                      ? "Prices need refreshing"
                      : canDecide
                        ? "Ready for your approval"
                        : undefined
                }
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium">{proposal.lines[0]?.name ?? "Purchase basket"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {proposal.lines.map((l) => `${l.quantity} ${l.salesUnit ?? "units"}`).join(" · ")}{" "}
                  · Needed {displayDate(proposal.pricingDate)}
                </p>
              </div>
              <PriceDisplay value={proposal.totalExclVat} currency={proposal.currency} />
            </div>
            {proposal.status === "BLOCKED" && (
              <p className="text-sm text-destructive">
                {proposal.decision.reasons.map((r) => r.message).join(" ")}
              </p>
            )}
            {proposal.approval?.status === "REJECTED" && (
              <p className="text-sm">
                Reason: {proposal.approval.comment ?? "The purchase was declined."} You can revise
                this request in the Assistant.
              </p>
            )}
            {proposal.lines.some(
              (l) =>
                !l.orderable ||
                l.availableQuantity === null ||
                (l.availableQuantity ?? 0) < l.quantity,
            ) && (
              <p className="text-sm text-warning">
                Some availability or quantity conditions need attention. Review them before
                deciding.
              </p>
            )}
            {proposal.status === "READY" &&
              proposal.decision.outcome === "ALLOW" &&
              !confirmedSupply && (
                <p className="text-sm text-warning">
                  Autonomous ordering is paused because supply is not confirmed. Ask an Approver to
                  require human review in purchasing policies, then prepare a fresh proposal, or
                  choose a product with confirmed supply.
                </p>
              )}
            {
              <details>
                <summary className="min-h-11 py-3 text-sm">
                  View items ({proposal.lines.length})
                </summary>
                <div className="divide-y">
                  {proposal.lines.map((line) => (
                    <ProductLine line={line} key={line.productId} />
                  ))}
                </div>
              </details>
            }
            <ProductComparison proposal={proposal} />
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
            </EvidenceDisclosure>
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
        <div className="flex flex-wrap items-center gap-3">
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
          {canDecide &&
            (onReview ? (
              <Button onClick={onReview}>Review & approve</Button>
            ) : (
              <ActionConfirmation
                title="Approve this purchase?"
                description={
                  buyer
                    ? "Approve the exact purchase shown and record its order after the pricing and availability checks."
                    : "Approve the exact purchase shown. A Buyer will record the order after pricing and availability checks."
                }
                trigger={reviewLayout ? "Approve" : "Review & approve"}
                confirmLabel={buyer ? "Approve & record order" : "Approve purchase"}
                onConfirm={approve}
              />
            ))}
          {canDecide && (
            <ActionConfirmation
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
            </ActionConfirmation>
          )}
          {buyer &&
            !stale &&
            (proposal.status === "APPROVED" ||
              (proposal.status === "READY" &&
                confirmedSupply &&
                proposal.decision.outcome === "ALLOW" &&
                proposal.decision.limits.autonomy === "order_within_limits")) && (
              <ActionConfirmation
                title="Record this order?"
                description="The service will recheck the fixed prices and availability. Supplier dispatch and payment are not connected."
                trigger="Record order"
                confirmLabel="Record order"
                onConfirm={() => store.placeOrder(proposal.id).then(() => {})}
              />
            )}
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
          {proposal.orderId && (
            <Link className={buttonVariants()} href={`/orders/${proposal.orderId}`}>
              View order
            </Link>
          )}
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
            ["READY", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status) && (
              <ActionConfirmation
                title="Withdraw this request?"
                description="This purchase and its pending review will no longer be actionable."
                trigger="Withdraw request"
                confirmLabel="Withdraw"
                destructive
                onConfirm={() => store.cancel(proposal.id)}
              />
            )}
        </div>
        {proposal.status === "PENDING_APPROVAL" && !approver && (
          <p className="text-caption text-muted-foreground">
            Waiting for another authorized approver. You can still discuss changes in the Assistant.
          </p>
        )}
        {reviewLayout && (
          <p className="flex items-start gap-2 border-t pt-4 text-[11px] leading-relaxed text-muted-foreground">
            <Icon name="shield-outline" className="size-3.5 shrink-0" />
            Decisions apply to this exact proposal. Ordering rechecks prices and availability.
          </p>
        )}
      </Panel>
    </div>
  );
}

export function BasketReviewDrawer({
  proposal,
  threadId,
  onClose,
}: {
  proposal: Proposal;
  threadId?: string;
  onClose: () => void;
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
    <aside aria-label="Review order" className="review-drawer">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="section-title">Review order</h2>
        <Button
          ref={close}
          variant="ghost"
          size="icon"
          aria-label="Close order review"
          onClick={onClose}
        >
          <Icon name="close" />
        </Button>
      </div>
      <ApprovalCard proposal={proposal} threadId={threadId} />
    </aside>
  );
}
