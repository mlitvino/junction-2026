"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/client/use-workspace";
import { today } from "@/client/workspace/service";
import { PlanSchema, type RestockPlan } from "@/client/workspace/model";
import { Button, buttonVariants } from "@/components/ui/button";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { useAction } from "@/features/procurement/use-action";
import {
  store,
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  EvidenceDisclosure,
  StatusBadge,
  inputClass,
  displayDate,
} from "./ui";
import { useLoad } from "./use-load";

export function RestockPlanCard({ plan }: { plan: RestockPlan }) {
  const action = useAction(),
    router = useRouter();
  return (
    <Panel>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h3 className="font-semibold">{plan.name}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {plan.current} {plan.unit} on hand · Trigger below {plan.threshold} · Target{" "}
            {plan.target} {plan.unit}
          </p>
          <p className="mt-2 text-caption text-muted-foreground">
            {plan.location} ·{" "}
            {plan.schedule === "weekly" ? "Weekly check configured" : "Threshold check configured"}{" "}
            · {plan.paused ? "Paused" : "Run manually"}
          </p>
        </div>
        <StatusBadge
          status={plan.paused ? "CANCELLED" : "PENDING"}
          label={plan.paused ? "Paused" : "Prepare for review"}
        />
      </div>
      <ErrorMessage error={action.error} />
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const run = await store.checkPlan(plan.id);
              router.push(`/restocking/runs/${run.id}`);
            })
          }
        >
          {action.busy ? "Checking…" : "Run check now"}
        </Button>
        <Link
          href={`/restocking/plans/${plan.id}`}
          className={buttonVariants({ variant: "ghost" })}
        >
          Edit plan
        </Link>
        <Button variant="ghost" onClick={() => store.pausePlan(plan.id)}>
          {plan.paused ? "Resume plan" : "Pause plan"}
        </Button>
      </div>
    </Panel>
  );
}
export function Restocking() {
  const s = useWorkspace(),
    action = useAction(),
    [alerts, setAlerts] = useState<string[]>([]);
  const router = useRouter();
  const error = useLoad(() => store.loadInventory(), "restock-inventory");
  const low = s.inventory.filter(
    (i) => i.minParLevel !== null && i.quantityInStock < i.minParLevel,
  );
  return (
    <Page
      title="Keep your kitchen stocked"
      description="Review low stock, configure replenishment and prepare purchases with human oversight."
      wide
      action={
        <Link href="/restocking/new" className={buttonVariants()}>
          Create restock plan
        </Link>
      }
    >
      <ErrorMessage error={error || action.error} />
      <Button
        variant="outline"
        disabled={action.busy || !s.local.plans.length}
        onClick={() =>
          void action.run(async () => {
            const run = await store.checkAllPlans();
            router.push(`/restocking/runs/${run.id}`);
          })
        }
      >
        Run all checks now
      </Button>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">Needs attention ({low.length})</h2>
          <Link
            href="/restocking/inventory"
            className="min-h-11 py-3 text-sm text-primary underline"
          >
            Manage kitchen stock
          </Link>
        </div>
        {low.length
          ? low.map((item) => (
              <Panel key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="font-medium">{item.ingredientName}</h3>
                    <p className="mt-2 text-sm text-warning">
                      {item.quantityInStock} {item.unit} available is below the {item.minParLevel}{" "}
                      {item.unit} trigger.
                    </p>
                    <p className="mt-2 text-caption text-muted-foreground">
                      Snapshot: {displayDate(item.updatedAt)} · {item.location ?? "Kitchen"}
                    </p>
                  </div>
                  <Link href="/restocking/new" className={buttonVariants({ variant: "outline" })}>
                    Prepare restock plan
                  </Link>
                </div>
              </Panel>
            ))
          : !error && (
              <EmptyState title="No low-stock items in the current snapshot">
                Stock levels are snapshots; live POS synchronization is not connected.
              </EmptyState>
            )}
      </section>
      <section className="space-y-4">
        <h2 className="section-title">Your restock plans ({s.local.plans.length})</h2>
        {s.local.plans.map((plan) => (
          <RestockPlanCard key={plan.id} plan={plan} />
        ))}
        {!s.local.plans.length && (
          <EmptyState title="Start with one kitchen essential">
            Choose its trigger and target to prepare future replenishment.
          </EmptyState>
        )}
      </section>
      <EvidenceDisclosure title={`Recent checks (${s.local.runs.length}) · Show history`}>
        <ul className="divide-y">
          {s.local.runs.map((run) => (
            <li key={run.id}>
              <Link
                className="block min-h-11 py-3 text-primary"
                href={`/restocking/runs/${run.id}`}
              >
                {s.local.plans.find((p) => p.id === run.planId)?.name ?? "Restock check"} ·{" "}
                {displayDate(run.at)}
              </Link>
            </li>
          ))}
        </ul>
      </EvidenceDisclosure>
      <Button
        variant="outline"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const result = await store.api.getAlerts(today());
            setAlerts(result.alerts.map((a) => `${a.affectedName}: ${a.shortageSummary}`));
            if (!result.alerts.length) setAlerts(["No additional stockout alerts were returned."]);
          })
        }
      >
        Check supplier stockout alerts
      </Button>
      {alerts.map((text) => (
        <p key={text} className="text-sm">
          {text}
        </p>
      ))}
      <EvidenceDisclosure title="About restocking plans">
        <p>
          Plans are stored in this browser. A schedule records your intended cadence; unattended
          background execution is not connected. Checks run only when you choose Run check now.
        </p>
        <p>
          Stock is not reserved by a local plan. Open purchasing requests are checked to avoid
          obvious duplicate coverage.
        </p>
      </EvidenceDisclosure>
    </Page>
  );
}

function PlanEditor({ existing }: { existing?: RestockPlan }) {
  const s = useWorkspace(),
    router = useRouter(),
    action = useAction();
  const [draft, setDraft] = useState<RestockPlan>(() => {
    const saved = s.local.drafts["restock:new"];
    if (!existing && saved) {
      try {
        const parsed = PlanSchema.safeParse(JSON.parse(saved));
        if (parsed.success) return parsed.data;
      } catch {
        /* Start with a blank plan. */
      }
    }
    return (
      existing ?? {
        id: `plan-${crypto.randomUUID()}`,
        name: "",
        ingredient: "",
        productId: "",
        unit: "KG",
        current: 0,
        threshold: 12,
        target: 40,
        location: "Main kitchen",
        schedule: "threshold",
        paused: false,
      }
    );
  });
  const [verified, setVerified] = useState("");
  function field<K extends keyof RestockPlan>(key: K, value: RestockPlan[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          const parsed = PlanSchema.parse(draft);
          if (parsed.target < parsed.threshold)
            throw new Error("Target stock must be at least the trigger level.");
          await store.loadProduct(parsed.productId);
          store.savePlan(parsed);
          store.draft("restock:new", "");
          router.push("/restocking");
        });
      }}
    >
      <ErrorMessage error={action.error} />
      <Panel>
        <h2 className="section-title">1. What</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-label">
            Plan name
            <input
              required
              className={`${inputClass} mt-2`}
              value={draft.name}
              onChange={(e) => field("name", e.target.value)}
            />
          </label>
          <label className="text-label">
            Choose kitchen stock
            <select
              aria-label="Choose kitchen stock"
              className={`${inputClass} mt-2`}
              value={draft.inventoryId ?? ""}
              onChange={(e) => {
                const item = s.inventory.find((i) => i.id === e.target.value);
                if (item)
                  setDraft((d) => ({
                    ...d,
                    inventoryId: item.id,
                    ingredient: item.ingredientName,
                    productId: item.linkedProductId ?? "",
                    unit: item.unit,
                    current: item.quantityInStock,
                    threshold: item.minParLevel ?? d.threshold,
                    name: d.name || item.ingredientName,
                    location: item.location ?? d.location,
                  }));
              }}
            >
              <option value="">Enter a product manually</option>
              {s.inventory.map((i) => (
                <option value={i.id} key={i.id}>
                  {i.ingredientName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-label">
            Ingredient
            <input
              required
              className={`${inputClass} mt-2`}
              value={draft.ingredient}
              onChange={(e) => field("ingredient", e.target.value)}
            />
          </label>
          <label className="text-label">
            Catalog product code
            <input
              required
              className={`${inputClass} mt-2`}
              value={draft.productId}
              onChange={(e) => {
                field("productId", e.target.value);
                setVerified("");
              }}
            />
          </label>
          <label className="text-label">
            Location
            <input
              className={`${inputClass} mt-2`}
              value={draft.location}
              onChange={(e) => field("location", e.target.value)}
            />
          </label>
        </div>
        <Button
          variant="outline"
          className="mt-4"
          disabled={!draft.productId || action.busy}
          onClick={() =>
            void action.run(async () => {
              const p = await store.loadProduct(draft.productId);
              setVerified(`${p.name} · Sales unit ${p.salesUnit}`);
            })
          }
        >
          Verify selected product
        </Button>
        {verified && (
          <p className="mt-3 text-sm" role="status">
            {verified}
          </p>
        )}
      </Panel>
      <Panel>
        <h2 className="section-title">2. How much</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {(["current", "threshold", "target"] as const).map((key) => (
            <label className="text-label" key={key}>
              {key === "current"
                ? "Current stock"
                : key === "threshold"
                  ? "Reorder below"
                  : "Target stock"}
              <input
                required
                min={key === "target" ? 0.01 : 0}
                type="number"
                step="any"
                className={`${inputClass} mt-2`}
                value={draft[key]}
                onChange={(e) => field(key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <label className="mt-4 block max-w-40 text-label">
          Stock unit
          <input
            required
            className={`${inputClass} mt-2`}
            value={draft.unit}
            onChange={(e) => field("unit", e.target.value.toUpperCase())}
          />
        </label>
        <p className="mt-4 text-sm">
          If the trigger is reached: {Math.max(0, draft.target - draft.current)} {draft.unit} would
          be needed.
        </p>
        <EvidenceDisclosure title="Unit conversion details">
          <p>
            Only compatible units and catalog net-weight/pack evidence are converted. Unknown
            physical conversions remain excluded until reviewed.
          </p>
        </EvidenceDisclosure>
      </Panel>
      <Panel>
        <h2 className="section-title">3. When</h2>
        <label className="mt-5 block text-label">
          Check cadence
          <select
            aria-label="Check cadence"
            className={`${inputClass} mt-2`}
            value={draft.schedule}
            onChange={(e) => field("schedule", e.target.value as RestockPlan["schedule"])}
          >
            <option value="threshold">When stock is below the trigger</option>
            <option value="weekly">Weekly kitchen check</option>
          </select>
        </label>
        <p className="mt-4 text-sm font-medium">Prepare a purchase proposal for human review</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Configured locally. Background scheduling is not connected; run checks manually from
          Restocking.
        </p>
      </Panel>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={action.busy}>
          {action.busy ? "Saving…" : existing ? "Save plan changes" : "Save restock plan"}
        </Button>
        <Link href="/restocking" className={buttonVariants({ variant: "ghost" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
export function RestockEditor({ id }: { id?: string }) {
  const s = useWorkspace(),
    error = useLoad(() => store.loadInventory(), "plan-inventory");
  const existing = s.local.plans.find((p) => p.id === id);
  return (
    <Page
      title={id ? "Edit restock plan" : "Create restock plan"}
      description="Set a clear stock target and prepare replenishment for review."
    >
      <ErrorMessage error={error} />
      {!id || existing ? (
        <>
          <PlanEditor existing={existing} />
          {existing && (
            <ActionConfirmation
              title="Delete this local plan?"
              description="This removes the plan from this browser. Purchasing records already created are kept."
              trigger="Delete plan"
              confirmLabel="Delete plan"
              destructive
              onConfirm={async () => {
                store.deletePlan(existing.id);
                window.location.assign(new URL("/restocking", window.location.origin).href);
              }}
            />
          )}
        </>
      ) : (
        <EmptyState title="Restock plan not found">
          This plan may belong to another browser or have been deleted.
        </EmptyState>
      )}
    </Page>
  );
}
export function RestockRunResults({ id }: { id: string }) {
  const s = useWorkspace(),
    action = useAction(),
    router = useRouter(),
    run = s.local.runs.find((r) => r.id === id);
  return (
    <Page
      title="Restock check results"
      description={
        run
          ? `${displayDate(run.at)} · Review the items that are ready and resolve exceptions.`
          : undefined
      }
    >
      <ErrorMessage error={action.error} />
      {run ? (
        <>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={action.busy || !run.lines.some((l) => l.state === "ready")}
              onClick={() =>
                void action.run(async () => {
                  const result = await store.prepareRun(id);
                  router.push(`/buyer/conversations/${result.threadId}`);
                })
              }
            >
              Review purchase proposal
            </Button>
            <Link href="/restocking" className={buttonVariants({ variant: "outline" })}>
              Back to restocking
            </Link>
          </div>
          {(["ready", "partial", "unknown", "covered"] as const).map((state) => {
            const rows = run.lines.filter((l) => l.state === state);
            return rows.length ? (
              <section className="space-y-4" key={state}>
                <h2 className="section-title">
                  {state === "ready"
                    ? "Ready"
                    : state === "partial"
                      ? "Partial or late"
                      : state === "unknown"
                        ? "Availability not confirmed"
                        : "Covered by current stock"}{" "}
                  ({rows.length})
                </h2>
                {rows.map((line) => (
                  <Panel key={line.productId}>
                    <h3 className="font-medium">{line.name}</h3>
                    <p className="mt-2 text-sm">
                      {line.quantity} {line.unit}
                    </p>
                    <p
                      className={`mt-2 text-sm ${state === "unknown" || state === "partial" ? "text-warning" : "text-muted-foreground"}`}
                    >
                      {line.reason}
                    </p>
                    {(state === "unknown" || state === "partial") && (
                      <p className="mt-3 text-caption font-medium">
                        Excluded from proposal · Resolve the missing evidence before ordering
                      </p>
                    )}
                  </Panel>
                ))}
              </section>
            ) : null;
          })}
          <EvidenceDisclosure title="Check provenance">
            <p>
              This check was run manually. Inventory and price snapshots can change; pending
              purchases are not inventory reservations. Proposal prices and policy are re-evaluated
              by the purchasing service.
            </p>
          </EvidenceDisclosure>
        </>
      ) : (
        <EmptyState title="Check not found in this browser">
          Return to Restocking and run a new check.
        </EmptyState>
      )}
    </Page>
  );
}

export function Inventory() {
  const s = useWorkspace(),
    action = useAction(),
    error = useLoad(() => store.loadInventory(), "inventory-page");
  return (
    <Page
      title="Kitchen stock"
      description="Maintain the stock snapshot used by recipe and replenishment planning."
      wide
    >
      <ErrorMessage error={error || action.error} />
      <div className="space-y-4">
        <Panel>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-medium">
              Add kitchen stock
            </summary>
            <form
              className="mt-4 grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget,
                  data = new FormData(form);
                void action.run(async () => {
                  await store.api.saveInventory({
                    ingredientName: String(data.get("ingredient")),
                    productType: String(data.get("ingredient")),
                    quantityInStock: Number(data.get("quantity")),
                    unit: String(data.get("unit")),
                    minParLevel: Number(data.get("minimum")),
                    location: String(data.get("location")) || null,
                  });
                  await store.loadInventory();
                  form.reset();
                });
              }}
            >
              <label className="text-label">
                Stock ingredient
                <input name="ingredient" required maxLength={80} className={`${inputClass} mt-2`} />
              </label>
              <label className="text-label">
                Initial on-hand quantity
                <input
                  name="quantity"
                  required
                  type="number"
                  min="0"
                  step="any"
                  defaultValue="0"
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label className="text-label">
                Stock unit
                <select name="unit" aria-label="Stock unit" className={`${inputClass} mt-2`}>
                  {["KG", "G", "L", "ML", "ST"].map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>
              <label className="text-label">
                Minimum stock level
                <input
                  name="minimum"
                  required
                  type="number"
                  min="0"
                  step="any"
                  defaultValue="0"
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label className="text-label">
                Storage location
                <input name="location" maxLength={120} className={`${inputClass} mt-2`} />
              </label>
              <div className="flex items-end">
                <Button type="submit" disabled={action.busy}>
                  Add stock snapshot
                </Button>
              </div>
            </form>
          </details>
        </Panel>
        {s.inventory.map((item) => (
          <Panel key={item.id}>
            <h2 className="font-semibold">{item.ingredientName}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {item.location} · {item.unit} · Snapshot {displayDate(item.updatedAt)}
            </p>
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                void action.run(async () => {
                  await store.api.adjustInventory(item.id, {
                    quantityInStock: Number(values.get("quantity")),
                  });
                  await store.loadInventory();
                });
              }}
            >
              <label className="text-label">
                On-hand quantity
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="any"
                  required
                  defaultValue={item.quantityInStock}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <Button type="submit" variant="outline" disabled={action.busy}>
                Update stock snapshot
              </Button>
            </form>
          </Panel>
        ))}
      </div>
      <Link href="/restocking" className={buttonVariants({ variant: "outline" })}>
        Back to restocking
      </Link>
    </Page>
  );
}
