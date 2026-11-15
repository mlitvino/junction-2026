"use client";

import { useEffect, useState } from "react";
import type { Proposal } from "@/shared/contracts/purchasing";
import { Icon } from "@/components/ui/icon";

const checks = [
  {
    label: "Budget",
    codes: [
      "ORDER_VALUE_TOO_HIGH",
      "UNIT_PRICE_TOO_HIGH",
      "LINE_QUANTITY_TOO_HIGH",
      "ABOVE_AUTO_APPROVAL",
    ],
  },
  { label: "Allergens", codes: ["EXCLUDED_ALLERGEN", "MAY_CONTAIN_EXCLUDED_ALLERGEN"] },
  { label: "Substitutes", codes: ["SUBSTITUTE_NOT_ALLOWED"] },
  {
    label: "Delivery",
    codes: [
      "LATE_DELIVERY",
      "INSUFFICIENT_STOCK",
      "SALES_BLOCKED",
      "NOT_ORDERABLE",
      "AVAILABILITY_UNKNOWN",
    ],
  },
];

export function TradeAirlock({ proposal }: { proposal: Proposal }) {
  const [clock, setClock] = useState(() => Date.now());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 750);
    return () => clearTimeout(timer);
  }, [highlight]);
  const remaining = proposal.quoteExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(proposal.quoteExpiresAt) - clock) / 1000))
    : null;
  const mode =
    proposal.decision.outcome === "DENY"
      ? "halt"
      : ["APPROVED", "ORDERED"].includes(proposal.status)
        ? "clear"
        : proposal.decision.outcome === "REQUIRE_APPROVAL"
          ? "hold"
          : "clear";
  const tone =
    mode === "halt" ? "text-destructive" : mode === "hold" ? "text-warning" : "text-success";
  const closed = ["CANCELLED", "REJECTED", "EXPIRED"].includes(proposal.status);
  return (
    <section
      className="luukku-airlock overflow-hidden rounded-xl border"
      aria-label="Purchase policy gateway"
    >
      <div className="luukku-airlock-grid">
        <div className="luukku-bay" data-highlight={highlight === "dock"}>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            01 / Agent dock
          </p>
          <p className="mt-3 text-sm font-semibold">Purchase request</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {proposal.lines.length} {proposal.lines.length === 1 ? "product" : "products"} ·{" "}
            {proposal.createdByName ?? "Organization buyer"}
          </p>
          <p className="mt-3 text-[10px] text-muted-foreground">Delivery {proposal.pricingDate}</p>
        </div>
        <div className="luukku-bay luukku-prism" data-highlight={highlight === "policy"}>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            02 / Policy interlock
          </p>
          <svg
            viewBox="0 0 300 80"
            preserveAspectRatio="none"
            className={`luukku-beam ${tone}`}
            data-mode={mode}
            aria-hidden="true"
          >
            <path
              d={
                mode === "hold"
                  ? "M0 40H150L210 16H300"
                  : mode === "halt"
                    ? "M0 40H150"
                    : "M0 40H300"
              }
            />
          </svg>
          <div className="luukku-pins" key={`${proposal.id}:${proposal.status}`}>
            {checks.map((check, index) => {
              const reasons = proposal.decision.reasons.filter((r) => check.codes.includes(r.code));
              const state = reasons.some((r) => r.outcome === "DENY")
                ? "halt"
                : reasons.some((r) => r.outcome === "REQUIRE_APPROVAL") &&
                    !["APPROVED", "ORDERED"].includes(proposal.status)
                  ? "hold"
                  : "clear";
              return (
                <div
                  key={check.label}
                  className="min-w-0 text-center"
                  title={
                    reasons.map((r) => r.message).join(" ") ||
                    "No flag from this policy evaluation. This does not verify product safety."
                  }
                >
                  <span
                    className={`luukku-pin ${state === "halt" ? "text-destructive" : state === "hold" ? "text-warning" : "text-success"}`}
                    data-state={state}
                    style={{ animationDelay: `${index * 55}ms` }}
                  />
                  <span className="block text-[9px] text-muted-foreground">{check.label}</span>
                  <span className="sr-only">
                    {state === "clear"
                      ? "No policy flag"
                      : state === "hold"
                        ? "Review required"
                        : "Policy blocked"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className={`text-center font-mono text-[10px] uppercase tracking-wide ${tone}`}>
            {closed
              ? proposal.status
              : proposal.status === "ORDERED"
                ? "Order recorded"
                : proposal.status === "APPROVED"
                  ? "Human approved"
                  : mode === "hold"
                    ? "Awaiting human sign-off"
                    : mode === "halt"
                      ? "Policy blocked"
                      : "Within purchasing policy"}
          </p>
          <p className="mt-2 text-center text-[9px] leading-relaxed text-muted-foreground">
            Pins show policy flags, not product safety certification.
          </p>
        </div>
        <div className="luukku-bay luukku-vault" data-highlight={highlight === "quote"}>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            03 / Quote chamber
          </p>
          <div className="luukku-vault-window mt-3 rounded-lg border p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium">
              <Icon name="shield-outline" className="size-3.5" />
              {proposal.signature ? "Signature attached" : "Unsigned proposal"}
            </p>
            <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">
              {proposal.status === "ORDERED"
                ? "Order committed"
                : remaining === null
                  ? "Quote expiry unavailable"
                  : remaining === 0
                    ? "Quote expired"
                    : `Quote ${Math.floor(remaining / 3600)}h ${String(Math.floor(remaining / 60) % 60).padStart(2, "0")}m ${String(remaining % 60).padStart(2, "0")}s`}
            </p>
          </div>
          <p className="mt-2 text-[9px] text-muted-foreground">
            Quoted availability · not reserved stock
          </p>
        </div>
      </div>
      <div className="luukku-trace border-t bg-card" data-open={traceOpen}>
        <button
          type="button"
          className="flex min-h-9 w-full items-center justify-between gap-2 px-4 text-left text-[10px] text-muted-foreground"
          aria-expanded={traceOpen}
          onClick={() => setTraceOpen(!traceOpen)}
        >
          Policy trace · {proposal.decision.reasons.length} conditions
          <Icon
            name="chevron"
            className={`size-3 transition-transform ${traceOpen ? "rotate-90" : ""}`}
          />
        </button>
        <div>
          <div className="min-h-0 overflow-hidden">
            <ul className="space-y-1 px-3 pb-3">
              {proposal.decision.reasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-2 text-left text-xs leading-relaxed hover:bg-accent"
                    onClick={() => setHighlight("policy")}
                  >
                    {reason.message}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="w-full break-all rounded px-2 py-2 text-left font-mono text-[10px] text-muted-foreground hover:bg-accent"
                  onClick={() => setHighlight("quote")}
                >
                  Proposal hash: {proposal.hash}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="w-full rounded px-2 py-2 text-left text-[10px] text-muted-foreground hover:bg-accent"
                  onClick={() => setHighlight("dock")}
                >
                  Requested {proposal.createdAt} · Policy evaluated {proposal.decision.evaluatedAt}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
