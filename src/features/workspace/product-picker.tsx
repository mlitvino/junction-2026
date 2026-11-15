"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductSummary } from "@/shared/contracts/products";
import type { Proposal } from "@/shared/contracts/purchasing";
import { useAction } from "@/features/procurement/use-action";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { today } from "@/client/workspace/service";
import { useWorkspace } from "@/client/use-workspace";
import {
  store,
  inputClass,
  ErrorMessage,
  EvidenceDisclosure,
  PriceDisplay,
  EmptyState,
} from "./ui";

export function ProductPicker({
  initialQuery = "",
  threadId,
  replacementId,
  pickerId,
  readOnly = false,
  completedProposal,
}: {
  initialQuery?: string;
  threadId?: string;
  replacementId?: string;
  pickerId?: string;
  readOnly?: boolean;
  completedProposal?: Proposal;
}) {
  const [query, setQuery] = useState(initialQuery),
    [offset, setOffset] = useState(0),
    [date, setDate] = useState(today);
  const [results, setResults] = useState<ProductSummary[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null),
    [selected, setSelected] = useState<Record<string, number>>({}),
    [preview, setPreview] = useState<string | null>(null);
  const s = useWorkspace(),
    action = useAction(),
    router = useRouter();
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      store
        .searchProducts(query, offset)
        .then((result) => {
          if (active) {
            setResults(result.items);
            setTotal(result.total);
            setError(null);
            setLoading(false);
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setError(error);
            setLoading(false);
          }
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, offset, readOnly]);
  const lines = Object.entries(selected)
    .filter(([, q]) => q > 0)
    .map(([productId, quantity]) => ({ productId, quantity }));
  if (readOnly)
    return (
      <details
        className="group/selection rounded-lg border bg-card px-4 md:px-6"
        aria-label="Completed product selection"
      >
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 py-3">
          <Icon
            name={completedProposal ? "check-circle" : "clock"}
            className="shrink-0 text-primary"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {completedProposal ? "Products selected" : "Product selection closed"}
            </span>
            <span className="mt-1 block text-caption text-muted-foreground">
              {completedProposal
                ? `${completedProposal.lines.length} item${completedProposal.lines.length === 1 ? "" : "s"} · Selection saved for review`
                : initialQuery}
            </span>
          </span>
          <Icon
            name="chevron"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open/selection:rotate-90"
          />
        </summary>
        <div className="space-y-3 border-t py-4 text-sm">
          <p className="text-caption text-muted-foreground">
            This selection is read-only. Send a new message to change the purchase.
          </p>
          {completedProposal && (
            <>
              <ul className="space-y-2">
                {completedProposal.lines.map((line) => (
                  <li key={line.productId}>
                    {line.quantity} {line.salesUnit} × {line.name}
                  </li>
                ))}
              </ul>
              <p className="text-caption text-muted-foreground">
                Needed by: {completedProposal.pricingDate}
              </p>
            </>
          )}
        </div>
      </details>
    );
  return (
    <section aria-label="Product picker" className="space-y-5 rounded-lg border bg-card p-4 md:p-6">
      <fieldset disabled={action.busy} className="contents">
        <div>
          <h2 className="section-title">Choose products for your kitchen</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Confirm quantities in the supplier’s sales units. Physical volumes require verified
            packaging information.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <label className="text-label">
            Search products
            <input
              type="search"
              className={`${inputClass} mt-2`}
              value={query}
              maxLength={200}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
              placeholder="Product, brand or product code"
            />
          </label>
          <label className="text-label">
            Needed by
            <input
              type="date"
              required
              className={`${inputClass} mt-2`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <ErrorMessage error={error || action.error} />
        {loading ? (
          <p role="status" className="py-6 text-muted-foreground">
            Searching the catalog…
          </p>
        ) : !results.length ? (
          <EmptyState title="No products found">Try fewer words or a product code.</EmptyState>
        ) : (
          <ul className="divide-y">
            {results.map((product) => {
              const offer =
                s.offers?.date === date
                  ? s.offers.offers.find((o) => o.productId === product.id)
                  : undefined;
              const detail = s.productDetails[product.id];
              return (
                <li className="space-y-3 py-4" key={product.id}>
                  <div className="flex flex-wrap items-start gap-3">
                    <label className="flex min-w-0 flex-1 items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        checked={selected[product.id] !== undefined}
                        disabled={
                          selected[product.id] === undefined && Object.keys(selected).length >= 50
                        }
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (e.target.checked) next[product.id] = 1;
                            else delete next[product.id];
                            return next;
                          })
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium">{product.name}</span>
                        <span className="mt-1 block text-caption text-muted-foreground">
                          {product.vendorName} · {product.salesUnit} ·{" "}
                          {product.countryOfOrigin?.toUpperCase() ?? "Origin not available"}
                        </span>
                      </span>
                    </label>
                    {selected[product.id] !== undefined && (
                      <label className="w-28 text-caption">
                        Quantity ({product.salesUnit})
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          className={`${inputClass} mt-1`}
                          value={selected[product.id]}
                          onChange={(e) => {
                            setSelected((current) => ({
                              ...current,
                              [product.id]: Number(e.target.value),
                            }));
                            setPreview(null);
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <details
                    onToggle={(e) => {
                      if (e.currentTarget.open && !detail)
                        void action.run(() => store.loadProduct(product.id));
                    }}
                  >
                    <summary className="min-h-11 py-3 text-caption text-muted-foreground">
                      Product, allergens & unit details
                    </summary>
                    {detail ? (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>
                          Sales unit: {detail.salesUnit}; base unit: {detail.baseUnit}; allowed lot:{" "}
                          {detail.allowedLotSize}.
                        </p>
                        <p>
                          Allergen codes:{" "}
                          {detail.allergens.join(", ") ||
                            "Not supplied — absence does not verify free-from claims."}
                        </p>
                        <p>
                          Net weight per base unit:{" "}
                          {detail.netWeightKg == null
                            ? "Not available"
                            : `${detail.netWeightKg} kg`}
                          .
                        </p>
                        <p>
                          {detail.units
                            .map((u) => `${u.unitId}: ${u.sizeInBaseUnits} base units`)
                            .join(" · ")}
                        </p>
                      </div>
                    ) : (
                      <p className="text-caption">Loading product details…</p>
                    )}
                  </details>
                  {offer && (
                    <div className="flex flex-wrap justify-between gap-3 border-t pt-3">
                      <p className="text-caption text-muted-foreground">
                        {offer.availability?.logisticModel === "terminal" ||
                        !offer.availability?.orderable
                          ? "Availability not confirmed"
                          : `Snapshot quantity: ${offer.availability.availableQuantity ?? "Not available"} ${product.salesUnit}`}
                      </p>
                      <PriceDisplay value={offer.price?.priceExclVat} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
          <span>
            {total} products · {Object.keys(selected).length} selected
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              disabled={offset + 20 >= total || loading}
              onClick={() => setOffset(offset + 20)}
            >
              Next
            </Button>
          </div>
        </div>
        {preview && (
          <p className="rounded-lg bg-muted p-4 text-sm" role="status">
            {preview}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={!lines.length || action.busy || !date}
            onClick={() =>
              void action.run(async () => {
                await store.quote(
                  lines.map((l) => l.productId),
                  date,
                );
                const policy = await store.api.evaluatePolicy({ lines, date });
                setPreview(
                  `${policy.outcome === "DENY" ? "Needs attention" : policy.outcome === "ALLOW" ? "Within explicitly configured autonomous limits" : "Human approval required"}. ${policy.reasons.map((r) => r.message).join(" ")}`,
                );
              })
            }
          >
            Check prices & conditions
          </Button>
          <Button
            disabled={!lines.length || action.busy || !date || !s.user?.roles.includes("buyer")}
            onClick={() =>
              void action.run(async () => {
                const result = await store.createPurchase(
                  { lines, date },
                  threadId,
                  "Manual",
                  replacementId,
                  pickerId,
                );
                router.push(`/buyer/conversations/${result.threadId}`);
              })
            }
          >
            {action.busy ? "Preparing…" : "Prepare purchase for review"}
          </Button>
        </div>
        <EvidenceDisclosure title="About quantity and price checks">
          <p>
            Only the selected shortlist is priced. The proposal service calculates the fixed quote
            and policy decision again. A product name alone is not proof of litres per case or
            allergen safety.
          </p>
        </EvidenceDisclosure>
      </fieldset>
    </section>
  );
}
