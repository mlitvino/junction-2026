import type {
  ProvisionalEvidence,
  ProvisionalProposal,
  ProvisionalProduct,
} from "@/client/provisional/types";
import { date, money, timestamp } from "./format";
import { StatusChip } from "./status";

const isReal = (evidence: ProvisionalEvidence) => evidence.offer.source !== "SYNTHETIC_FRONTEND_FIXTURE";

export function ProductEvidence({ evidence }: { evidence: ProvisionalEvidence }) {
  const real = isReal(evidence);
  return (
    <details className="mt-4 text-sm">
      <summary className="min-h-11 py-3 text-muted-foreground">
        Why this product? View {real ? "catalog" : "fixture"} evidence
      </summary>
      <div className="space-y-3 border-t py-4">
        <p>{evidence.selectionReason}</p>
        {evidence.constraintResults.map((result) => (
          <p key={result.code}>
            {result.result === "PASS"
              ? real
                ? "Meets requirement"
                : "Meets requirement in this fixture"
              : "Requirement not verified"}
            : {result.reason}
          </p>
        ))}
        <p className="text-caption text-muted-foreground">
          {real
            ? evidence.offer.source === "VALIO_API"
              ? "Valio catalog · live price and availability, checked "
              : "Backend mock data (no Valio API key on the server), checked "
            : "Synthetic frontend fixture · recorded "}
          <time dateTime={evidence.offer.checkedAt}>{timestamp(evidence.offer.checkedAt)}</time>{" "}
          (Helsinki).{" "}
          {real
            ? "Allergen and safety evidence is not part of this data."
            : "No live price, stock, allergen or supplier validation was performed."}
        </p>
        <p className="text-caption text-muted-foreground">
          {real
            ? "Litres per case are a curated assumption from the product name, not verified supplier packaging data."
            : "Physical quantities use a curated demo assumption of one litre per sales unit. This is not verified supplier packaging data."}
        </p>
      </div>
    </details>
  );
}

export function ProductRecommendation({
  proposal,
  products,
}: {
  proposal: ProvisionalProposal;
  products: readonly ProvisionalProduct[];
}) {
  return (
    <section aria-labelledby="recommended-title" className="rounded-lg border bg-card p-4 md:p-6">
      <h2 id="recommended-title" className="mb-4 text-caption font-medium text-muted-foreground">
        {proposal.policyDecision.outcome === "DENY"
          ? "Candidate for review · not eligible to purchase"
          : proposal.lines.some((line) => isReal(line.evidence))
            ? "Recommended purchase · real catalog prices, simulated order"
            : "Recommended purchase · synthetic demo"}
      </h2>
      {proposal.lines.map((line) => {
        const product = products.find((p) => p.productId === line.productId);
        const uncertain =
          line.evidence.match !== "PASS" || line.evidence.offer.stockCertainty !== "STOCK_VERIFIED";
        return (
          <div key={line.productId}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold">
                  {product?.name ?? "Product unavailable"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {product?.brand} · {line.selectedSalesQuantity.value}{" "}
                  {line.selectedSalesQuantity.unit}
                  {line.estimatedPhysicalQuantity
                    ? ` · ${line.estimatedPhysicalQuantity.value} ${line.estimatedPhysicalQuantity.unit} ${isReal(line.evidence) ? "in total" : "in the fixture"}`
                    : ""}
                </p>
              </div>
              <p className="text-xl font-semibold tabular-nums">
                {money(line.lineTotalGross)}
                <span className="mt-1 block text-caption font-normal text-muted-foreground">
                  {isReal(line.evidence) ? "Total, incl. VAT" : "Demo total, incl. VAT"}
                </span>
              </p>
            </div>
            <div className="mt-4">
              <StatusChip tone={uncertain ? "warning" : "neutral"}>
                {uncertain
                  ? "Supplier inventory unconfirmed"
                  : `${isReal(line.evidence) ? "Available" : "Available in this fixture"} · ${date(line.evidence.offer.availableDate)}`}
              </StatusChip>
            </div>
            {uncertain && (
              <p className="mt-4 text-sm text-warning">
                {line.evidence.constraintResults.find((result) => result.result !== "PASS")
                  ?.reason ??
                  "Availability cannot be verified. Do not rely on this candidate for a purchase."}
              </p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">{line.evidence.selectionReason}</p>
            <ProductEvidence evidence={line.evidence} />
          </div>
        );
      })}
    </section>
  );
}

export function ProductComparison({
  proposal,
  products,
}: {
  proposal: ProvisionalProposal;
  products: readonly ProvisionalProduct[];
}) {
  if (!proposal.alternatives.length) return null;
  return (
    <details className="rounded-lg border bg-card px-4 md:px-6">
      <summary className="min-h-11 py-4 text-sm font-medium">
        Compare alternatives ({proposal.alternatives.length})
      </summary>
      <div className="divide-y">
        {proposal.alternatives.map((candidate) => (
          <div key={candidate.productId} className="py-4">
            <h3 className="font-medium">
              {products.find((p) => p.productId === candidate.productId)?.name ??
                "Product unavailable"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {money(candidate.offer.priceGross)} per {candidate.offer.salesUnit} ·{" "}
              {isReal(candidate) ? "unit price" : "synthetic unit price"}, not a proposal total
            </p>
            <p className="mt-2 text-sm">{candidate.selectionReason}</p>
            <p className="mt-2 text-caption text-muted-foreground">
              Comparison only. Selecting a different product requires a new proposal and is not
              supported in this demo.
            </p>
            <ProductEvidence evidence={candidate} />
          </div>
        ))}
      </div>
    </details>
  );
}
