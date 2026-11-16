"use client";

import Link from "next/link";
import { useState } from "react";
import { mayAttempt, useWorkspace } from "@/client/use-workspace";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useAction } from "@/features/procurement/use-action";
import {
  PreferencesLayerValuesSchema,
  type LayersResponse,
  type PreferencesLayerValues,
  type SettingKey,
} from "@/shared/contracts/preferences";
import { AdminNavigation } from "./settings";
import { ErrorMessage, Page, Panel, inputClass, store } from "./ui";
import { useLoad } from "./use-load";

const policyKeys = [
  "autonomy",
  "allowSubstitutes",
  "maxOrderValue",
  "autoApproveBelow",
  "dailySpendingCap",
  "exactMatchOnly",
  "softBudgetTolerance",
  "preferenceOnlySubstitutions",
  "preferredBrands",
] as const;
type PolicyValues = Pick<PreferencesLayerValues, (typeof policyKeys)[number]>;

function buyerPolicies(layers: LayersResponse): PolicyValues {
  const defaults: PolicyValues = {
    autonomy: "suggest_only",
    allowSubstitutes: false,
    maxOrderValue: null,
    autoApproveBelow: null,
    dailySpendingCap: null,
    exactMatchOnly: false,
    softBudgetTolerance: false,
    preferenceOnlySubstitutions: false,
    preferredBrands: [],
  };
  return Object.fromEntries(
    policyKeys.map((key) => [
      key,
      !layers.base.locked.includes(key) && Object.hasOwn(layers.buyer.values, key)
        ? layers.buyer.values[key]
        : Object.hasOwn(layers.base.values, key)
          ? layers.base.values[key]
          : defaults[key],
    ]),
  ) as PolicyValues;
}

function PolicySwitch({
  label,
  description,
  checked = false,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-16 items-center justify-between gap-6 py-3 ${disabled ? "text-muted-foreground" : ""}`}
    >
      <span>
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{label}</span>
        <span className="mt-1 block text-caption text-muted-foreground">{description}</span>
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
          className="peer sr-only"
        />
        <span className="h-6 w-11 rounded-full border border-input bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring peer-disabled:opacity-40" />
        <span className="pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-card shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function PolicyEditor({
  layers,
  readOnly = false,
}: {
  layers: LayersResponse;
  readOnly?: boolean;
}) {
  const [values, setValues] = useState<PolicyValues>(() => buyerPolicies(layers));
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const action = useAction();
  const autonomous = values.autonomy === "order_within_limits";
  const locked = (key: SettingKey) => layers.base.locked.includes(key);
  function put<K extends keyof PolicyValues>(key: K, value: PolicyValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
    setDirty(true);
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          const changes = Object.fromEntries(
            Object.entries(values).filter(([key]) => !locked(key as SettingKey)),
          );
          const parsed = PreferencesLayerValuesSchema.parse({
            ...layers.buyer.values,
            ...changes,
            ...(values.preferredBrands
              ? { preferredBrands: values.preferredBrands.filter(Boolean) }
              : {}),
          });
          // Locked values must inherit from the organization, including any legacy overrides.
          for (const key of layers.base.locked) delete parsed[key];
          await store.saveLayer("buyer", { values: parsed });
          setSaved(true);
          setDirty(false);
        });
      }}
    >
      <ErrorMessage error={action.error} />
      <fieldset disabled={action.busy || readOnly} className="space-y-5">
        <Panel>
          <div className="mb-6 flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 font-mono text-sm text-primary">
              01
            </span>
            <div>
              <h2 className="section-title">Primary authorization mode</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Choose when the assistant needs a human before confirming a purchase.
              </p>
            </div>
          </div>
          <div role="radiogroup" aria-label="Primary authorization mode" className="space-y-3">
            {(
              [
                [
                  "suggest_only",
                  "Human approval for every purchase",
                  "Recommended",
                  "The assistant searches, compares and prepares proposals. An authorized person approves every order.",
                ],
                [
                  "order_within_limits",
                  "Autonomous with guardrails",
                  "Admin opt-in",
                  "Allow the assistant to confirm purchases within your spending limits and purchasing rules.",
                ],
              ] as const
            ).map(([mode, title, badge, description]) => (
              <div
                key={mode}
                className={`rounded-xl border transition-colors ${values.autonomy === mode ? "border-primary bg-primary/5 ring-1 ring-primary/15" : "border-border"}`}
              >
                <label className="flex cursor-pointer items-start gap-3 p-4 md:p-5">
                  <input
                    type="radio"
                    name="authorization-mode"
                    value={mode}
                    checked={values.autonomy === mode}
                    disabled={locked("autonomy")}
                    onChange={() => {
                      put("autonomy", mode);
                      if (mode === "suggest_only" && !locked("autoApproveBelow"))
                        put("autoApproveBelow", null);
                      if (mode === "order_within_limits") {
                        if (values.maxOrderValue == null && !locked("maxOrderValue"))
                          put("maxOrderValue", 500);
                        if (values.autoApproveBelow == null && !locked("autoApproveBelow"))
                          put("autoApproveBelow", Math.min(values.maxOrderValue ?? 500, 100));
                      }
                    }}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {title}
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-medium tracking-wide ${mode === "suggest_only" ? "bg-success-surface text-success" : "bg-secondary text-muted-foreground"}`}
                      >
                        {badge}
                      </span>
                    </span>
                    <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </label>
                {mode === "order_within_limits" && (
                  <div className="mx-4 border-t pb-2 md:mx-5 md:ml-12">
                    <p className="pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      Autonomous guardrails
                    </p>
                    <div className="divide-y divide-border/60">
                      <PolicySwitch
                        label="Exact match only"
                        description="Verify the same item, brand and supplier before every purchase."
                        checked={values.exactMatchOnly}
                        disabled={!autonomous || locked("exactMatchOnly")}
                        onChange={(value) => put("exactMatchOnly", value)}
                      />
                      <PolicySwitch
                        label="Preference-only substitutions"
                        description="Allow approved brand alternatives when the requested item is unavailable."
                        checked={values.allowSubstitutes && values.preferenceOnlySubstitutions}
                        disabled={
                          !autonomous ||
                          locked("allowSubstitutes") ||
                          locked("preferenceOnlySubstitutions")
                        }
                        onChange={(value) => {
                          put("allowSubstitutes", value);
                          put("preferenceOnlySubstitutions", value);
                        }}
                      />
                      {values.preferenceOnlySubstitutions && (
                        <div className="py-3">
                          <label
                            htmlFor="policy-brands"
                            className="text-caption text-muted-foreground"
                          >
                            Approved brands (comma-separated)
                          </label>
                          <input
                            id="policy-brands"
                            className={`${inputClass} mt-2`}
                            value={(values.preferredBrands ?? []).join(", ")}
                            disabled={!autonomous || locked("preferredBrands")}
                            onChange={(event) =>
                              put(
                                "preferredBrands",
                                event.target.value.split(",").map((brand) => brand.trim()),
                              )
                            }
                          />
                          <p className="mt-1 text-caption text-muted-foreground">
                            Use catalog brand names. An empty list requires approval for every
                            substitute.
                          </p>
                        </div>
                      )}
                      <PolicySwitch
                        label="Soft budget tolerance (+5%)"
                        description="Allow recurring item prices up to 5% above the last purchase, within all spending limits. Signed quotes stay fixed."
                        checked={values.softBudgetTolerance}
                        disabled={!autonomous || locked("softBudgetTolerance")}
                        onChange={(value) => put("softBudgetTolerance", value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {locked("autonomy") && (
            <p className="mt-4 flex items-center gap-2 text-caption text-muted-foreground">
              <Icon name="lock" className="size-3.5" />
              Authorization mode is set by your organization.
            </p>
          )}
        </Panel>
        <Panel>
          <div className="mb-6 flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 font-mono text-sm text-primary">
              02
            </span>
            <div>
              <h2 className="section-title">Spending limits & organization governance</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Set the financial boundaries for kitchen purchases. All amounts exclude VAT.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-secondary/40 p-5">
              <label htmlFor="policy-order-cap" className="text-sm font-medium">
                Max per order
              </label>
              <div className="mt-3 flex items-center gap-2 border-b border-input pb-2">
                <span className="font-mono text-xl text-muted-foreground">€</span>
                <input
                  id="policy-order-cap"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="No limit"
                  disabled={locked("maxOrderValue")}
                  value={values.maxOrderValue ?? ""}
                  onChange={(event) =>
                    put(
                      "maxOrderValue",
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                  className="min-h-11 w-full min-w-0 bg-transparent font-mono text-2xl font-semibold tabular-nums outline-offset-2 placeholder:text-base placeholder:font-normal"
                />
              </div>
              <p className="mt-3 text-caption leading-relaxed text-muted-foreground">
                Orders above this cap are blocked. Clear the amount to remove the limit.
                {locked("maxOrderValue") ? " Locked by your organization." : ""}
              </p>
            </div>
            <div className="rounded-xl border bg-secondary/20 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="policy-daily-cap" className="text-sm font-medium">
                  Daily spending cap
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2 border-b border-input pb-2">
                <span className="font-mono text-xl text-muted-foreground">€</span>
                <input
                  id="policy-daily-cap"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="No limit"
                  disabled={locked("dailySpendingCap")}
                  value={values.dailySpendingCap ?? ""}
                  onChange={(event) =>
                    put(
                      "dailySpendingCap",
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                  className="min-h-11 w-full min-w-0 bg-transparent font-mono text-2xl font-semibold tabular-nums placeholder:text-base placeholder:font-normal"
                />
              </div>
              <p className="mt-3 text-caption leading-relaxed text-muted-foreground">
                Combined spending across your organization over a rolling 24 hours. Clear the amount
                to remove the limit.
              </p>
            </div>
          </div>
          <div className="mt-5 grid items-center gap-3 rounded-lg border border-dashed p-4 sm:grid-cols-[1fr_180px]">
            <div>
              <label htmlFor="policy-approval-limit" className="text-sm font-medium">
                Automatic approval below
              </label>
              <p className="mt-1 text-caption text-muted-foreground">
                {autonomous
                  ? "Larger purchases need human approval, up to the order cap."
                  : "Every purchase requires human approval in the selected mode."}
                {locked("autoApproveBelow") ? " Locked by your organization." : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">€</span>
              <input
                id="policy-approval-limit"
                type="number"
                min="0"
                max={values.maxOrderValue ?? undefined}
                step="0.01"
                placeholder="Always review"
                className={inputClass}
                disabled={!autonomous || locked("autoApproveBelow")}
                value={values.autoApproveBelow ?? ""}
                onChange={(event) =>
                  put(
                    "autoApproveBelow",
                    event.target.value === "" ? null : Number(event.target.value),
                  )
                }
              />
            </div>
          </div>
        </Panel>
      </fieldset>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4">
          <p
            role="status"
            className={`text-caption ${saved ? "text-success" : "text-muted-foreground"}`}
          >
            {saved
              ? "Purchasing policies saved."
              : dirty
                ? "You have unsaved changes."
                : "These policies apply to your organization’s buyers."}
          </p>
          <Button type="submit" disabled={action.busy || !dirty}>
            {action.busy ? "Saving…" : "Save policies"}
            <Icon name="arrow-right" className="ml-2 size-4" />
          </Button>
        </div>
      )}
    </form>
  );
}

/** What a guest sees: the system defaults, editable; saving asks them to sign in. */
const GUEST_LAYERS: LayersResponse = {
  base: { scope: "base", values: {}, locked: [], updatedAt: null },
  buyer: { scope: "buyer", values: {}, locked: [], updatedAt: null },
  approver: { scope: "approver", values: {}, locked: [], updatedAt: null },
};

export function Policies() {
  const s = useWorkspace();
  const error = useLoad(() => store.loadSettings(), "policy-layers");
  const guest = s.ready && !s.user && !s.error;
  const canEdit = mayAttempt(s, "approver");
  const visibleLayers = guest
    ? GUEST_LAYERS
    : canEdit
    ? s.layers
    : s.effective?.buyer
      ? {
          base: { scope: "base" as const, values: {}, locked: [], updatedAt: null },
          buyer: {
            scope: "buyer" as const,
            values: s.effective.buyer.values,
            locked: [],
            updatedAt: null,
          },
          approver: { scope: "approver" as const, values: {}, locked: [], updatedAt: null },
        }
      : null;
  return (
    <Page
      title="Purchasing policies"
      description="Delegated authority, clear limits and human oversight."
      wide
    >
      <AdminNavigation />
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <Link
          href="/admin/agents"
          className="inline-flex min-h-9 items-center gap-2 text-caption text-muted-foreground hover:text-foreground"
        >
          <Icon name="arrow-left" className="size-3.5" />
          Back to agents
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
              Agent permissions
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">
              Kitchen Purchasing Assistant
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Configure how your assistant purchases and when your team steps in.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success-surface px-3 py-1.5 text-caption text-success">
            <span className="size-1.5 rounded-full bg-success" />
            {canEdit ? "Organization policies" : "View only"}
          </span>
        </div>
        <ErrorMessage error={error} />
        {visibleLayers ? (
          <PolicyEditor key={s.user?.organization.id} layers={visibleLayers} readOnly={!canEdit} />
        ) : (
          !error && (
            <p className="text-sm text-muted-foreground">
              {canEdit
                ? "Loading purchasing policies…"
                : "Your organization’s approvers manage purchasing policies."}
            </p>
          )
        )}
      </div>
    </Page>
  );
}
