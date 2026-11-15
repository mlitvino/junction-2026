"use client";

import Link from "next/link";
import { useState } from "react";
import type { Proposal } from "@/shared/contracts/purchasing";
import type { Thread } from "@/client/workspace/model";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAction } from "@/features/procurement/use-action";
import { store, eur, ErrorMessage } from "./ui";

type Tone = "good" | "warn" | "bad";

/** Step 6: the proposal total against the organization's budget and auto-approve limits. */
export function budgetVerdict(proposal: Proposal): { text: string; tone: Tone } {
  const { limits, outcome } = proposal.decision;
  const total = proposal.totalExclVat;
  const overMax = total !== null && limits.maxOrderValue !== null && total > limits.maxOrderValue;
  const overAuto =
    total !== null && limits.autoApproveBelow !== null && total >= limits.autoApproveBelow;
  if (overMax) return { text: "Exceeds max order budget — blocked", tone: "bad" };
  if (outcome === "DENY") return { text: "Blocked by purchasing policy", tone: "bad" };
  if (overAuto)
    return {
      text: "Exceeds auto-approve threshold — human approval required",
      tone: "warn",
    };
  if (limits.autonomy === "suggest_only")
    return {
      text: "Within budget — human approval required (suggest-only mode)",
      tone: "warn",
    };
  if (outcome === "ALLOW") return { text: "Within budget & auto-approve limit", tone: "good" };
  return { text: "Human approval required", tone: "warn" };
}

export function BudgetComparison({ proposal }: { proposal: Proposal }) {
  const { limits } = proposal.decision;
  const verdict = budgetVerdict(proposal);
  const statusText = verdict.text;
  const overMax = verdict.tone === "bad";
  const outcome = proposal.decision.outcome;
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
  compact = false,
}: {
  proposal: Proposal;
  threadId?: string;
  canRevise: boolean;
  onRevised?: (revised: Proposal) => void;
  compact?: boolean;
}) {
  const selection = proposal.selection;
  const action = useAction();
  const [swapState, setSwapState] = useState<{ proposalId: string; id: string } | null>(null);
  const swappedId = swapState?.proposalId === proposal.id ? swapState.id : null;
  if (!selection) return null;
  const proposalLineIds = new Set(proposal.lines.map((l) => l.productId));

  return (
    <details
      className={
        compact
          ? "group/selection rounded-lg text-sm"
          : "group/selection rounded-md border bg-muted/30 px-4 py-2 text-sm"
      }
      open={!compact}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-lg px-2 py-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
        <Icon name="agents" className="size-4 shrink-0 text-primary" />
        <span className="flex-1">
          Agent selection &amp; preference filtering ({selection.extractedItems.length} item
          {selection.extractedItems.length === 1 ? "" : "s"})
        </span>
        <Icon
          name="chevron"
          className="size-3.5 shrink-0 transition-transform group-open/selection:rotate-90"
        />
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
                  {step.matchedByTypeCount} found for type &ldquo;{step.extractedItem.productType}
                  &rdquo;
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
                    Excluded by preferences (dietary, allergens, blocked vendors, CO2, reliability)
                    ({step.removedByPreferences.length})
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
                              {eur(candidate.unitPriceEur, proposal.currency)} /{" "}
                              {candidate.salesUnit}
                              {" · "}
                              {Math.round(candidate.nameMatchScore * 100)}% name match
                              {candidate.availableQuantity != null
                                ? ` · ${candidate.availableQuantity} avail.`
                                : ""}
                              {candidate.previouslyOrderedProduct ? " · Previously ordered" : ""}
                              {!candidate.previouslyOrderedProduct &&
                              candidate.previouslyOrderedBrand
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

type StepState = "done" | "attention" | "pending" | "skipped";
type AgentStep = {
  n?: number;
  title: string;
  detail: string;
  state: StepState;
  link?: { href: string; label: string };
};

const list = (items: string[], max = 3) =>
  items.length <= max
    ? items.join("; ")
    : `${items.slice(0, max).join("; ")}; +${items.length - max} more`;
const qty = (n: number) => `${Number(n.toFixed(3))}`;

function approvalStep(proposal: Proposal): AgentStep {
  const title = "Ask for approval or changes";
  const { approval, decision } = proposal;
  switch (proposal.status) {
    case "BLOCKED":
      return {
        title,
        state: "attention",
        detail: `Blocked by policy: ${decision.reasons.map((r) => r.message).join(" ") || "no reason given"}. Change the request to try again.`,
      };
    case "PENDING_APPROVAL":
      return {
        title,
        state: "pending",
        detail: `Waiting for an approver${approval?.requestedByName ? ` (sent by ${approval.requestedByName})` : ""}. You can still ask for changes, e.g. “change X to Y”.`,
      };
    case "APPROVED":
      return {
        title,
        state: "done",
        detail: `Approved${approval?.decidedByName ? ` by ${approval.decidedByName}` : ""}${approval?.comment ? `: “${approval.comment}”` : ""}. Ready to check out.`,
      };
    case "REJECTED":
      return {
        title,
        state: "attention",
        detail: `Rejected${approval?.decidedByName ? ` by ${approval.decidedByName}` : ""}: ${approval?.comment ?? "no comment"}. Ask the assistant for changes.`,
      };
    case "CANCELLED":
      return { title, state: "skipped", detail: "Withdrawn or replaced by a changed proposal." };
    case "EXPIRED":
      return {
        title,
        state: "attention",
        detail: "The quote expired before anyone decided. Prepare a new proposal.",
      };
    case "ORDERED":
      return {
        title,
        state: "done",
        detail: approval?.decidedByName
          ? `Approved by ${approval.decidedByName}.`
          : "Allowed by the purchasing rules, no approval needed.",
      };
    default:
      return decision.outcome === "ALLOW"
        ? {
            title,
            state: "done",
            detail:
              "Within your rules: no approval needed. Change the order by asking the assistant, e.g. “change X to Y”, or check it out.",
          }
        : {
            title,
            state: "pending",
            detail:
              "Needs a human decision. Send it for review, or ask the assistant for changes, e.g. “change X to Y”.",
          };
  }
}

/**
 * The agent's walk-through from the user stories ("Simple buy X of Y" / "Order from a recipe"),
 * one row per step with what happened, derived from the frozen proposal and its `selection`.
 */
export function AgentSteps({
  proposal,
  reconciliation,
}: {
  proposal: Proposal;
  reconciliation?: Thread["recipeReconciliation"];
}) {
  const selection = proposal.selection;
  const serverSteps = selection?.steps;
  const steps: AgentStep[] = [];

  if (serverSteps && serverSteps.length > 0) {
    // The backend's own story steps, in order. Steps 8 and 9 are human steps: show the live state.
    const live = approvalStep(proposal);
    for (const step of serverSteps) {
      const title = `${step.title}${step.item ? ` — ${step.item}` : ""}`;
      if (step.key === "approval_or_change") steps.push({ ...live, n: step.step });
      else if (step.key === "checkout_receipt")
        steps.push(
          proposal.orderId
            ? {
                n: step.step,
                title,
                state: "done",
                detail: "Order recorded. The itemized receipt is ready.",
                link: { href: `/checkout/${proposal.orderId}`, label: "Open receipt" },
              }
            : {
                n: step.step,
                title,
                state: "pending",
                detail:
                  "After approval (or when your rules allow it), record the order to get the receipt.",
              },
        );
      else
        steps.push({
          n: step.step,
          title,
          detail: step.summary,
          state:
            step.status === "done"
              ? "done"
              : step.status === "skipped"
                ? "skipped"
                : step.status === "pending"
                  ? "pending"
                  : "attention",
        });
    }
  } else if (reconciliation) {
    const covered = reconciliation.items.filter((i) => i.coveredByInventory).length;
    steps.push(
      {
        title: "Query data from the recipe ([Product name] — [Product type] — [Quantity])",
        state: "done",
        detail: `${reconciliation.recipeName}: ${list(
          reconciliation.items.map(
            (i) =>
              `${i.productName} — ${i.productType} — ${qty(i.aggregatedBaseQuantity)} ${i.normalizedUnit}`,
          ),
        )} (per base batch of ${qty(reconciliation.requestedServings / reconciliation.scaleFactor)} portions).`,
      },
      {
        title: "Calculate the total quantity for each item",
        state: "done",
        detail: `${reconciliation.requestedServings} portions (${qty(reconciliation.scaleFactor)}× base): ${list(
          reconciliation.items.map(
            (i) => `${i.productName} ${qty(i.totalNeededQuantity)} ${i.normalizedUnit}`,
          ),
        )}.`,
      },
      {
        title: "Calculate what is actually needed (total − inventory stock)",
        state: covered === reconciliation.items.length ? "skipped" : "done",
        detail: `${reconciliation.items.length - covered} to order, ${covered} covered by kitchen stock. ${list(
          reconciliation.items
            .filter((i) => !i.coveredByInventory)
            .map(
              (i) =>
                `${i.productName}: ${qty(i.totalNeededQuantity)} − ${qty(i.inventoryStockQuantity)} = ${qty(i.actuallyNeededQuantity)} ${i.normalizedUnit}`,
            ),
        )}`,
      },
    );
  } else if (selection) {
    steps.push({
      title: "Extract the request ([Product name] — [Product type] — [Quantity])",
      state: selection.extractedItems.length > 0 ? "done" : "attention",
      detail: selection.extractedItems.length
        ? list(
            selection.extractedItems.map(
              (i) => `${i.productName} — ${i.productType} — ${i.productQuantity}`,
            ),
          )
        : "Nothing could be extracted from the request.",
    });
  }

  if (serverSteps && serverSteps.length > 0) {
    // already complete
  } else if (selection) {
    const pipeline = selection.pipeline;
    const removed = pipeline.reduce((n, p) => n + p.removedByPreferences.length, 0);
    steps.push(
      {
        title: "Look up products by product type",
        state:
          pipeline.length > 0 && pipeline.every((p) => p.matchedByTypeCount > 0)
            ? "done"
            : "attention",
        detail:
          list(
            pipeline.map((p) => `${p.extractedItem.productType}: ${p.matchedByTypeCount} found`),
          ) || "No candidates were looked up.",
      },
      {
        title: "Sort by best match with the product name",
        state:
          pipeline.length > 0 && pipeline.every((p) => p.selectedProduct) ? "done" : "attention",
        detail:
          list(
            pipeline.map((p) =>
              p.selectedProduct
                ? `${p.extractedItem.productName} → ${p.selectedProduct.name} (${Math.round(p.selectedProduct.nameMatchScore * 100)}% name match)`
                : `${p.extractedItem.productName} → no compliant match`,
            ),
          ) || "Nothing to match.",
      },
      {
        title: "Remove entries that fail your preferences (diet, allergens, nutrition)",
        state: "done",
        detail: removed
          ? `${removed} candidate${removed === 1 ? "" : "s"} removed: ${list(
              pipeline.flatMap((p) =>
                p.removedByPreferences.map((r) => `${r.name} (${r.reasons[0] ?? "rule"})`),
              ),
              2,
            )}.`
          : "No candidate had to be removed.",
      },
      {
        title: "Sort by order history (product, brand)",
        state: selection.previousOrdersUsed.length > 0 ? "done" : "skipped",
        detail: selection.previousOrdersUsed.length
          ? `${selection.previousOrdersUsed.length} earlier order${selection.previousOrdersUsed.length === 1 ? "" : "s"} considered; ${pipeline.filter((p) => p.selectedProduct?.previouslyOrderedProduct).length} chosen product(s) ordered before, ${pipeline.filter((p) => p.selectedProduct?.previouslyOrderedBrand).length} with a known brand.`
          : "No order history available, so history did not change the order of the list.",
      },
    );
  } else {
    steps.push({
      title: "Products chosen directly",
      state: "done",
      detail:
        "These lines were picked in the product picker, so no agent extraction or ranking ran.",
    });
  }

  const budget = budgetVerdict(proposal);
  if (!(serverSteps && serverSteps.length > 0))
    steps.push(
      {
        title: "Compare the price with your budget",
        state: budget.tone === "good" ? "done" : budget.tone === "bad" ? "attention" : "pending",
        detail: `${eur(proposal.totalExclVat, proposal.currency)} excl. VAT: ${budget.text}.`,
      },
      {
        title: "Create the order proposal",
        state: proposal.status === "BLOCKED" ? "attention" : "done",
        detail: `${proposal.lines.length} line${proposal.lines.length === 1 ? "" : "s"} at fixed prices${proposal.quoteExpiresAt ? ` until ${new Date(proposal.quoteExpiresAt).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" })}` : ""} — status ${proposal.status.toLowerCase().replace("_", " ")}.`,
      },
      approvalStep(proposal),
      proposal.orderId
        ? {
            title: "Check out and receipt",
            state: "done",
            detail: "Order recorded. The itemized receipt is ready.",
            link: { href: `/checkout/${proposal.orderId}`, label: "Open receipt" },
          }
        : {
            title: "Check out and receipt",
            state: "pending",
            detail:
              "After approval (or when your rules allow it), record the order to get the receipt.",
          },
    );

  return (
    <details className="rounded-md border bg-muted/30 px-4 py-2 text-sm" open>
      <summary className="min-h-10 cursor-pointer py-2 font-medium">
        Agent steps ({steps.length})
      </summary>
      <ol className="space-y-3 border-t py-3">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                step.state === "done"
                  ? "bg-success-surface text-success"
                  : step.state === "attention"
                    ? "bg-warning-surface text-warning"
                    : "bg-muted text-muted-foreground"
              }`}
              aria-hidden
            >
              {step.state === "done" ? (
                <Icon name="check-circle" className="size-4" />
              ) : (
                (step.n ?? index + 1)
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                <span className="sr-only">Step {step.n ?? index + 1}: </span>
                {step.title}
                {step.state === "skipped" && (
                  <span className="ml-2 text-caption font-normal text-muted-foreground">
                    skipped
                  </span>
                )}
              </p>
              <p className="text-caption text-muted-foreground">{step.detail}</p>
              {step.link && (
                <Link
                  href={step.link.href}
                  className={`${buttonVariants({ variant: "outline" })} mt-2`}
                >
                  {step.link.label}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
