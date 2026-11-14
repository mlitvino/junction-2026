import type { ProvisionalIntent } from "@/client/provisional/types";
import { date, money } from "./format";

export function PurchaseRequirements({ intent }: { intent: ProvisionalIntent }) {
  return (
    <section aria-labelledby="requirements-title" className="border-y py-5">
      <h2 id="requirements-title" className="mb-3 text-sm font-semibold">
        Your interpreted request{" "}
        <span className="font-normal text-muted-foreground">· Demo fixture</span>
      </h2>
      {intent.items.map((item) => (
        <div key={item.lineId} className="space-y-2">
          <p>
            {item.quantity.value} {item.quantity.unit} · {item.query}
          </p>
          <p className="text-sm text-muted-foreground">
            Required: {item.mandatoryClaims.join(", ") || "None"}
            {item.forbiddenAllergens.length
              ? ` · Exclude ${item.forbiddenAllergens.join(", ")}`
              : ""}
          </p>
        </div>
      ))}
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Delivery requested</dt>
          <dd className="mt-1">{date(intent.requestedDeliveryDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Budget, incl. VAT</dt>
          <dd className="mt-1 tabular-nums">{money(intent.budgetGross)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Preference</dt>
          <dd className="mt-1">
            {intent.preferences.preferOrigin === "FI" ? "Finnish origin" : "Not specified"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-caption text-muted-foreground">
        Quantities, date and requirements are prepared scenario values. To change them, start a new
        request; an existing proposal is never edited.
      </p>
    </section>
  );
}
