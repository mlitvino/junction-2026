"use client";

import { useState } from "react";
import type { Proposal } from "@/shared/contracts/purchasing";
import { Button } from "@/components/ui/button";
import { useAction } from "@/features/procurement/use-action";
import { store, eur, ErrorMessage } from "./ui";

export function BudgetComparison({ proposal }: { proposal: Proposal }) {
  const { limits, outcome } = proposal.decision;
  const total = proposal.totalExclVat;
  const overMax =
    total !== null && limits.maxOrderValue !== null && total > limits.maxOrderValue;
  const overAuto =
    total !== null && limits.autoApproveBelow !== null && total >= limits.autoApproveBelow;

  const statusText = overMax
    ? "Exceeds max order budget — blocked"
    : outcome === "DENY"
      ? "Blocked by purchasing policy"
      : overAuto
        ? "Exceeds auto-approve threshold — human approval required"
        : limits.autonomy === "suggest_only"
          ? "Within budget — human approval required (suggest-only mode)"
          : outcome === "ALLOW"
            ? "Within budget & auto-approve limit"
            : "Human approval required";

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Budget &amp; policy check</span>
        <span
          className={`text-caption font-medium ${
            overMax || outcome === "DENY"
              ? "text-destructive"
              : outcome === "ALLOW"
                ? "text-success"
                : "text-warning"
          }`}
        >
          {statusText}
        </span>
      </div>
      <dl className="mt-2 grid gap-2 text-caption text-muted-foreground sm:grid-cols-3">
        <div>
          <dt>Order total (excl. VAT)</dt>
          <dd className="font-medium text-foreground">
            {eur(proposal.totalExclVat, proposal.currency)}
          </dd>
        </div>
        <div>
          <dt>Max order budget</dt>
          <dd className="font-medium text-foreground">
            {limits.maxOrderValue !== null
              ? eur(limits.maxOrderValue, proposal.currency)
              : "No limit"}
          </dd>
        </div>
        <div>
          <dt>Auto-approve below</dt>
          <dd className="font-medium text-foreground">
            {limits.autoApproveBelow !== null
              ? eur(limits.autoApproveBelow, proposal.currency)
              : "Always requires approval"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function SelectionTrail({
  proposal,
  threadId,
  canRevise,
  onRevised,
}: {
  proposal: Proposal;
  threadId?: string;
  canRevise: boolean;
  onRevised?: (revised: Proposal) => void;
}) {
  const selection = proposal.selection;
  const action = useAction();
  const [swapState, setSwapState] = useState<{ proposalId: string; id: string } | null>(null);
  const swappedId = swapState?.proposalId === proposal.id ? swapState.id : null;
  if (!selection) return null;
  const proposalLineIds = new Set(proposal.lines.map((l) => l.productId));

  return (
    <details className="rounded-md border bg-muted/30 px-4 py-2 text-sm" open>
      <summary className="min-h-10 cursor-pointer py-2 font-medium">
        Agent selection &amp; preference filtering ({selection.extractedItems.length} item
        {selection.extractedItems.length === 1 ? "" : "s"})
      </summary>
      <div className="space-y-4 border-t py-3">
        <ErrorMessage error={action.error} />
        {selection.extractedItems.length > 0 && (
          <div>
            <h3 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              Extracted request ([Name] — [Type] — [Quantity])
            </h3>
            <ul className="mt-2 space-y-1">
              {selection.extractedItems.map((item, idx) => (
                <li key={idx} className="rounded bg-card px-3 py-1.5 text-sm">
                  <span className="font-medium">{item.productName}</span> — {item.productType} —{" "}
                  <span className="tabular-nums">{item.productQuantity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selection.pipeline.map((step, idx) => {
          const currentLine =
            proposal.lines.find((l) => l.productId === step.selectedProduct?.id) ??
            proposal.lines.find((l) => step.sortedCandidates.some((c) => c.id === l.productId));
          const currentProductId = currentLine?.productId ?? step.selectedProduct?.id ?? null;
          const currentProduct =
            step.sortedCandidates.find((c) => c.id === currentProductId) ??
            (step.selectedProduct?.id === currentProductId ? step.selectedProduct : null);

          return (
            <div key={idx} className="space-y-2 rounded-md border bg-card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {step.extractedItem.productName} ({step.parsedQuantity} {step.parsedUnit})
                </p>
                <span className="text-caption text-muted-foreground">
                  {step.matchedByTypeCount} found for type &ldquo;{step.extractedItem.productType}&rdquo;
                </span>
              </div>
              {step.conversionNote && (
                <p className="text-caption text-muted-foreground">
                  Unit conversion: {step.conversionNote}
                </p>
              )}
              {currentProduct || currentLine ? (
                <p className="text-caption text-success">
                  Selected: {currentProduct?.name ?? currentLine?.name}
                  {currentProduct?.rankReasons?.length
                    ? ` (${currentProduct.rankReasons.join(", ")})`
                    : ""}
                </p>
              ) : (
                <p className="text-caption text-destructive">
                  No compliant product matched all requirements.
                </p>
              )}

              {step.removedByPreferences.length > 0 && (
                <details className="text-caption">
                  <summary className="cursor-pointer text-muted-foreground">
                    Excluded by preferences (dietary, allergens, blocked vendors, CO2, reliability) (
                    {step.removedByPreferences.length})
                  </summary>
                  <ul className="mt-1 space-y-1 pl-3 text-muted-foreground">
                    {step.removedByPreferences.map((removed) => (
                      <li key={removed.id}>
                        <span className="font-medium text-foreground">{removed.name}</span>
                        {removed.brand ? ` (${removed.brand})` : ""}: {removed.reasons.join("; ")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {step.sortedCandidates.length > 0 && (
                <details className="text-caption">
                  <summary className="cursor-pointer text-muted-foreground">
                    Ranked candidates ({step.sortedCandidates.length})
                  </summary>
                  <ul className="mt-2 divide-y">
                    {step.sortedCandidates.slice(0, 5).map((candidate) => {
                      const isSelected = currentProductId === candidate.id;
                      const isInProposal = proposalLineIds.has(candidate.id);
                      return (
                        <li
                          key={candidate.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground">
                              {candidate.name}
                              {isSelected ? " (Selected)" : ""}
                            </p>
                            <p className="text-muted-foreground">
                              {eur(candidate.unitPriceEur, proposal.currency)} / {candidate.salesUnit}
                              {" · "}
                              {Math.round(candidate.nameMatchScore * 100)}% name match
                              {candidate.availableQuantity != null
                                ? ` · ${candidate.availableQuantity} avail.`
                                : ""}
                              {candidate.previouslyOrderedProduct ? " · Previously ordered" : ""}
                              {!candidate.previouslyOrderedProduct && candidate.previouslyOrderedBrand
                                ? " · Preferred brand"
                                : ""}
                            </p>
                            {candidate.rankReasons && candidate.rankReasons.length > 0 && (
                              <p className="text-muted-foreground">
                                {candidate.rankReasons.join(" · ")}
                              </p>
                            )}
                          </div>
                          {canRevise && currentProductId && !isInProposal && (
                            <Button
                              variant="outline"
                              disabled={action.busy || swappedId === candidate.id}
                              onClick={() =>
                                void action.run(async () => {
                                  setSwapState({ proposalId: proposal.id, id: candidate.id });
                                  try {
                                    const revised = await store.reviseProposal(
                                      proposal.id,
                                      {
                                        replacements: [
                                          {
                                            fromProductId: currentProductId,
                                            toProductId: candidate.id,
                                          },
                                        ],
                                      },
                                      threadId,
                                    );
                                    onRevised?.(revised.proposal);
                                  } finally {
                                    setSwapState(null);
                                  }
                                })
                              }
                            >
                              {swappedId === candidate.id ? "Swapping…" : "Swap to this"}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </div>
          );
        })}

        {selection.previousOrdersUsed.length > 0 && (
          <div className="text-caption text-muted-foreground">
            <span className="font-medium text-foreground">Order history considered: </span>
            {selection.previousOrdersUsed
              .slice(0, 3)
              .map((o) => `${o.productName} (${o.brand})`)
              .join(", ")}
          </div>
        )}
      </div>
    </details>
  );
}
