"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "@/client/use-workspace";
import {
  PreferencesLayerValuesSchema,
  PreferencesSchema,
  type LayerScope,
  type LayersResponse,
  type SettingKey,
} from "@/shared/contracts/preferences";
import { CreateMemberRequestSchema } from "@/shared/contracts/organization";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAction } from "@/features/procurement/use-action";
import {
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  EvidenceDisclosure,
  StatusBadge,
  inputClass,
  store,
} from "./ui";
import { useLoad } from "./use-load";

export function AdminNavigation() {
  return (
    <nav aria-label="Settings sections" className="flex flex-wrap gap-2 border-b pb-4">
      {[
        ["/admin/agents", "Agents & Policies"],
        ["/audit", "Activity & Audit"],
        ["/integrations", "Integrations"],
        ["/admin/organization", "Organization"],
      ].map(([href, label]) => (
        <Link key={href} href={href!} className={buttonVariants({ variant: "ghost" })}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function AgentRegistry() {
  const s = useWorkspace(),
    error = useLoad(() => store.loadSettings(), "agent-settings");
  return (
    <Page
      title="Settings & Administration"
      description="Manage purchasing rules, team access and integrations."
      wide
    >
      <AdminNavigation />
      <ErrorMessage error={error} />
      <section className="space-y-4">
        <h2 className="section-title">Purchasing capabilities</h2>
        <Panel>
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <h3 className="font-semibold">Kitchen Purchasing Assistant</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Human approval for every purchase by default. Uses your organization’s effective
                purchasing preferences.
              </p>
            </div>
            <Link href="/admin/agents/kitchen" className={buttonVariants({ variant: "outline" })}>
              {s.user?.roles.includes("approver") ? "Manage policies" : "View preferences"}
            </Link>
          </div>
        </Panel>
        <Panel>
          <h3 className="font-semibold">Scheduled restocking</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Manual checks are available. Background execution is not connected.
          </p>
          <Link href="/restocking" className={`${buttonVariants({ variant: "outline" })} mt-4`}>
            Manage local plans
          </Link>
        </Panel>
        <Panel>
          <div className="flex flex-wrap justify-between gap-4">
            <h3 className="font-semibold">External purchasing agents</h3>
            <StatusBadge status="CANCELLED" label="Not connected" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Scoped agent registration, credentials and revocation require backend support.
          </p>
          <Button className="mt-4" variant="outline" disabled>
            Register external agent
          </Button>
          <p className="mt-2 text-caption text-muted-foreground">
            No credentials can be issued from this interface yet.
          </p>
        </Panel>
      </section>
    </Page>
  );
}
const fieldLabels: Record<SettingKey, string> = {
  maxCo2PerKg: "Maximum CO₂ per kg",
  minDeliveryReliability: "Minimum delivery reliability (0–1)",
  preferredOriginCountries: "Preferred origin countries",
  excludedAllergens: "Excluded allergen codes",
  preferredVendors: "Preferred vendors",
  blockedVendors: "Blocked vendors",
  preferredBrands: "Preferred brands",
  maxOrderValue: "Maximum order value, EUR excl. VAT",
  autoApproveBelow: "Automatic approval below, EUR excl. VAT",
  autonomy: "Purchasing mode",
  allowSubstitutes: "Allow substitutes",
  language: "Assistant language",
};
const listKeys = [
  "preferredOriginCountries",
  "excludedAllergens",
  "preferredVendors",
  "blockedVendors",
  "preferredBrands",
];
const nullableKeys = ["maxCo2PerKg", "minDeliveryReliability", "maxOrderValue", "autoApproveBelow"];
const keys = Object.keys(PreferencesSchema.shape) as SettingKey[];
function LayerEditor({ scope, layers }: { scope: LayerScope; layers: LayersResponse }) {
  const initial = layers[scope],
    [values, setValues] = useState<Record<string, unknown>>({ ...initial.values }),
    [locked, setLocked] = useState<SettingKey[]>(initial.locked),
    [saved, setSaved] = useState(false);
  const action = useAction();
  function put(key: SettingKey, value: unknown) {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: value }));
  }
  function inherit(key: SettingKey) {
    setSaved(false);
    setValues((v) => {
      const next = { ...v };
      delete next[key];
      return next;
    });
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          const filtered = Object.fromEntries(
            Object.entries(values).filter(
              ([key]) => scope === "base" || !layers.base.locked.includes(key as SettingKey),
            ),
          );
          const parsed = PreferencesLayerValuesSchema.parse(filtered);
          await store.saveLayer(scope, { values: parsed, ...(scope === "base" ? { locked } : {}) });
          setSaved(true);
        });
      }}
    >
      <ErrorMessage error={action.error} />
      <Panel>
        <h2 className="section-title">Primary authorization mode</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Human review is the default. A different mode takes effect only after the service accepts
          these settings.
        </p>
        <div className="mt-5 space-y-3">
          {[
            ["suggest_only", "Human approval for every purchase"],
            ["order_within_limits", "Autonomous with guardrails"],
          ].map(([value, label]) => (
            <label key={value} className="flex min-h-12 items-start gap-3 rounded-lg border p-4">
              <input
                type="radio"
                name={`mode-${scope}`}
                className="mt-1 accent-primary"
                disabled={scope !== "base" && layers.base.locked.includes("autonomy")}
                checked={values.autonomy === value}
                onChange={() => {
                  put("autonomy", value);
                  if (value === "suggest_only") put("autoApproveBelow", null);
                  else {
                    if (values.maxOrderValue == null) put("maxOrderValue", 500);
                    if (values.autoApproveBelow == null) put("autoApproveBelow", 100);
                  }
                }}
              />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="mt-1 block text-caption text-muted-foreground">
                  {value === "suggest_only"
                    ? "Prepare proposals; an authorized person decides."
                    : "Only within explicit order limits and approval thresholds."}
                </span>
              </span>
            </label>
          ))}
        </div>
        {values.autonomy === undefined && (
          <p className="mt-3 text-caption text-muted-foreground">
            Mode inherits from the layer above.
          </p>
        )}
      </Panel>
      <Panel>
        <h2 className="section-title">Layer settings & inheritance</h2>
        <div className="mt-5 divide-y">
          {keys.map((key) => {
            const baseLocked = scope !== "base" && layers.base.locked.includes(key),
              configured = Object.hasOwn(values, key),
              val = values[key];
            return (
              <div key={key} className="grid gap-3 py-5 md:grid-cols-[1fr_140px_1fr]">
                <div>
                  <label htmlFor={`pref-${scope}-${key}`} className="text-label font-medium">
                    {fieldLabels[key]}
                  </label>
                  {baseLocked && (
                    <p className="mt-2 text-caption text-muted-foreground">
                      Locked by organization
                    </p>
                  )}
                  {scope === "base" && (
                    <label className="mt-3 flex min-h-9 items-center gap-2 text-caption">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={locked.includes(key)}
                        onChange={(e) =>
                          setLocked((l) =>
                            e.target.checked ? [...l, key] : l.filter((k) => k !== key),
                          )
                        }
                      />
                      Lock for role layers
                    </label>
                  )}
                </div>
                <select
                  aria-label={`${fieldLabels[key]} inheritance`}
                  className={inputClass}
                  disabled={baseLocked}
                  value={!configured ? "inherit" : val === null ? "unlimited" : "set"}
                  onChange={(e) => {
                    if (e.target.value === "inherit") inherit(key);
                    else if (e.target.value === "unlimited") put(key, null);
                    else
                      put(
                        key,
                        listKeys.includes(key)
                          ? []
                          : key === "autonomy"
                            ? "suggest_only"
                            : key === "language"
                              ? "en"
                              : key === "allowSubstitutes"
                                ? false
                                : 1,
                      );
                  }}
                >
                  <option value="inherit">Inherit</option>
                  <option value="set">Configure</option>
                  {nullableKeys.includes(key) && (
                    <option value="unlimited">
                      {key === "autoApproveBelow" ? "Always review" : "No limit"}
                    </option>
                  )}
                </select>
                {listKeys.includes(key) ? (
                  <input
                    id={`pref-${scope}-${key}`}
                    className={inputClass}
                    disabled={!configured || baseLocked}
                    placeholder="Comma-separated values"
                    value={Array.isArray(val) ? val.join(", ") : ""}
                    onChange={(e) =>
                      put(
                        key,
                        e.target.value
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                ) : key === "autonomy" || key === "language" ? (
                  <select
                    id={`pref-${scope}-${key}`}
                    className={inputClass}
                    disabled={!configured || baseLocked}
                    value={String(val ?? (key === "autonomy" ? "suggest_only" : "en"))}
                    onChange={(e) => put(key, e.target.value)}
                  >
                    {(key === "autonomy"
                      ? [
                          ["suggest_only", "Human approval"],
                          ["order_within_limits", "Within explicit limits"],
                        ]
                      : [
                          ["en", "English"],
                          ["fi", "Finnish"],
                          ["sv", "Swedish"],
                        ]
                    ).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                ) : key === "allowSubstitutes" ? (
                  <select
                    id={`pref-${scope}-${key}`}
                    className={inputClass}
                    disabled={!configured || baseLocked}
                    value={val === true ? "yes" : "no"}
                    onChange={(e) => put(key, e.target.value === "yes")}
                  >
                    <option value="no">No substitutes</option>
                    <option value="yes">Allow reviewed substitutes</option>
                  </select>
                ) : (
                  <input
                    id={`pref-${scope}-${key}`}
                    type="number"
                    className={inputClass}
                    step="any"
                    min="0"
                    max={key === "minDeliveryReliability" ? 1 : undefined}
                    disabled={!configured || val === null || baseLocked}
                    value={typeof val === "number" ? val : ""}
                    onChange={(e) => put(key, Number(e.target.value))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel>
        <h2 className="text-sm font-semibold">Advanced substitution guardrails</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Exact-match-only autonomy, permitted spend drift and separate mandatory-substitution
          controls are not independently enforced by the current service.
        </p>
        <fieldset disabled className="mt-4 space-y-3 text-sm text-muted-foreground">
          <label className="flex gap-3">
            <input type="checkbox" />
            Autonomous exact-match-only purchases
          </label>
          <label className="flex gap-3">
            <input type="checkbox" />
            Allow preference substitutions within a spend margin
          </label>
        </fieldset>
        <p className="mt-4 text-caption text-warning">
          Hard dietary and unknown safety requirements cannot be bypassed by these controls.
        </p>
      </Panel>
      {saved && (
        <p role="status" className="rounded-lg bg-secondary p-4 text-sm">
          Settings saved. Effective values were reloaded from the service.
        </p>
      )}
      <Button type="submit" disabled={action.busy}>
        {action.busy ? "Saving…" : "Save purchasing settings"}
      </Button>
    </form>
  );
}
export function Policies() {
  const s = useWorkspace(),
    [scope, setScope] = useState<LayerScope>("base");
  const error = useLoad(() => store.loadSettings(), "policy-layers");
  return (
    <Page
      title="Purchasing policies"
      description="Clear limits, inherited preferences and human oversight."
      wide
    >
      <AdminNavigation />
      <ErrorMessage error={error} />
      {s.user?.roles.includes("approver") && s.layers && (
        <>
          <div className="flex flex-wrap gap-3">
            {(["base", "buyer", "approver"] as const).map((value) => (
              <Button
                key={value}
                variant={scope === value ? "secondary" : "ghost"}
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
              >
                {value === "base"
                  ? "Organization base"
                  : `${value[0]!.toUpperCase()}${value.slice(1)} layer`}
              </Button>
            ))}
          </div>
          <LayerEditor key={scope} scope={scope} layers={s.layers} />
        </>
      )}
      <section>
        <h2 className="section-title mb-5">Your effective preferences</h2>
        <div className="space-y-5">
          {(["buyer", "approver"] as const).map((role) => {
            const effective = s.effective?.[role];
            return effective ? (
              <Panel key={role}>
                <h3 className="font-semibold">
                  {role === "buyer" ? "Buyer" : "Approver"} preferences
                </h3>
                <dl className="mt-4 space-y-3 text-sm">
                  {keys.map((key) => (
                    <div className="flex flex-wrap justify-between gap-3" key={key}>
                      <dt>{fieldLabels[key]}</dt>
                      <dd className="text-muted-foreground">
                        {Array.isArray(effective.values[key])
                          ? (effective.values[key] as string[]).join(", ") || "None"
                          : effective.values[key] === null
                            ? "No limit / review required"
                            : String(effective.values[key])}{" "}
                        · {effective.sources[key]}
                        {effective.locked.includes(key) ? " · locked" : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            ) : null;
          })}
        </div>
      </section>
    </Page>
  );
}
export function Organization() {
  const s = useWorkspace(),
    action = useAction(),
    [success, setSuccess] = useState("");
  const error = useLoad(
    () => (s.user?.roles.includes("approver") ? store.loadMembers() : Promise.resolve()),
    "organization",
  );
  return (
    <Page title="Organization" description={s.user?.organization.name} wide>
      <AdminNavigation />
      <ErrorMessage error={error || action.error} />
      {!s.user?.roles.includes("approver") ? (
        <EmptyState title="Member management requires an Approver">
          Ask an organization approver to manage access.
        </EmptyState>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="section-title">Your team</h2>
            {s.members.map((member) => (
              <Panel key={`${member.userId}:${member.roles.join(",")}`}>
                <form
                  className="flex flex-wrap items-center justify-between gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    const roles = [
                      data.has("buyer") ? "buyer" : null,
                      data.has("approver") ? "approver" : null,
                    ].filter((r): r is "buyer" | "approver" => !!r);
                    void action.run(async () => {
                      if (!roles.length) throw new Error("Keep at least one role for this member.");
                      await store.updateRoles(member.userId, roles);
                      setSuccess("Member roles updated.");
                    });
                  }}
                >
                  <div>
                    <h3 className="font-semibold">{member.username}</h3>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {member.userId === s.user?.id ? "Your account" : "Organization member"}
                    </p>
                  </div>
                  <fieldset className="flex flex-wrap gap-4">
                    <legend className="sr-only">Roles for {member.username}</legend>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        name="buyer"
                        type="checkbox"
                        defaultChecked={member.roles.includes("buyer")}
                      />
                      Buyer
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        name="approver"
                        type="checkbox"
                        defaultChecked={member.roles.includes("approver")}
                      />
                      Approver
                    </label>
                  </fieldset>
                  <Button type="submit" variant="outline" disabled={action.busy}>
                    Save roles
                  </Button>
                </form>
              </Panel>
            ))}
          </section>
          <Panel>
            <h2 className="section-title">Add a colleague</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Create an account within this organization. Share the initial password through your
              own secure channel.
            </p>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  data = new FormData(form);
                void action.run(async () => {
                  const member = CreateMemberRequestSchema.parse({
                    username: data.get("username"),
                    password: data.get("password"),
                    roles: [
                      data.has("buyer") ? "buyer" : null,
                      data.has("approver") ? "approver" : null,
                    ].filter(Boolean),
                  });
                  await store.createMember(member);
                  form.reset();
                  setSuccess("Colleague account created.");
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-label">
                  Username
                  <input
                    name="username"
                    required
                    minLength={3}
                    maxLength={30}
                    pattern="[a-zA-Z0-9_.]+"
                    autoComplete="off"
                    className={`${inputClass} mt-2`}
                  />
                </label>
                <label className="text-label">
                  Initial password
                  <input
                    name="password"
                    required
                    minLength={2}
                    type="password"
                    autoComplete="new-password"
                    className={`${inputClass} mt-2`}
                  />
                </label>
              </div>
              <fieldset className="flex gap-5">
                <legend className="sr-only">New colleague roles</legend>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input name="buyer" type="checkbox" defaultChecked />
                  Buyer
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input name="approver" type="checkbox" />
                  Approver
                </label>
              </fieldset>
              <Button type="submit" disabled={action.busy}>
                Create colleague account
              </Button>
            </form>
          </Panel>
          {success && (
            <p role="status" className="text-sm">
              {success}
            </p>
          )}
          <p className="text-caption text-muted-foreground">
            Your organization must keep at least one approver. The service enforces this rule.
          </p>
        </>
      )}
    </Page>
  );
}
export function Audit() {
  const s = useWorkspace(),
    [query, setQuery] = useState("");
  const events = s.local.activities.filter((e) =>
    `${e.text} ${e.resourceId}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Page
      title="Activity & Audit"
      description="Understand the purchasing decisions observed in this workspace."
      wide
    >
      <AdminNavigation />
      <input
        type="search"
        className={inputClass}
        aria-label="Search activity"
        placeholder="Search activity or reference"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!events.length ? (
        <EmptyState title="No matching activity yet">
          Prepare or review a purchase to start its local activity history.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <Panel key={event.id}>
              <h2 className="text-sm font-medium">{event.text}</h2>
              <time dateTime={event.at} className="mt-2 block text-caption text-muted-foreground">
                {new Date(event.at).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" })}
              </time>
              <EvidenceDisclosure title="Evidence">
                <p className="break-words">
                  {event.detail || "No additional details were recorded."}
                </p>
                <p className="break-all text-caption">Reference: {event.resourceId}</p>
              </EvidenceDisclosure>
            </Panel>
          ))}
        </div>
      )}
      <EvidenceDisclosure title="Activity scope">
        <p>
          This view contains events observed in this browser. Organization-wide audit retrieval,
          durable event attribution and external agent logs are not connected. It is not a
          tamper-proof or cryptographically verified ledger.
        </p>
      </EvidenceDisclosure>
    </Page>
  );
}
export function Integrations() {
  const action = useAction(),
    [health, setHealth] = useState("");
  return (
    <Page
      title="Integrations & connectivity"
      description="Know what is available and where external services are still needed."
      wide
    >
      <AdminNavigation />
      <ErrorMessage error={action.error} />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">Supplier catalog lookups</h2>
          <StatusBadge
            status="READY"
            label={store.mock ? "Local reference source" : "Available through application API"}
          />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Search the catalog and request prices for a shortlist. Provider availability is confirmed
          only by each successful lookup.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/buyer/products" className={buttonVariants({ variant: "outline" })}>
            Open product search
          </Link>
          <Button
            variant="ghost"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await store.api.getHealth();
                setHealth(
                  store.mock
                    ? "The development source is responding. No supplier connectivity was tested."
                    : "Application health check succeeded. This does not verify supplier availability.",
                );
              })
            }
          >
            Check application health
          </Button>
        </div>
        {health && (
          <p role="status" className="mt-3 text-sm">
            {health}
          </p>
        )}
        <EvidenceDisclosure title="View catalog source details">
          <p>
            Connected mode uses GET /api/products and POST /api/offers. Price and availability
            snapshots identify their source. Supplier Terminal stock is unconfirmed; it is never
            treated as a guaranteed quantity.
          </p>
        </EvidenceDisclosure>
      </Panel>
      <Panel>
        <h2 className="section-title">External agents · REST & MCP</h2>
        <p className="mt-3 text-sm">
          First-party purchasing API is available to authenticated organization members. External
          scoped credentials and MCP are not connected.
        </p>
        <EvidenceDisclosure title="View REST & MCP endpoints">
          <div className="flex flex-wrap gap-4">
            <a
              className="min-h-11 py-3 text-primary underline"
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
            >
              Open API documentation
            </a>
            <a
              className="min-h-11 py-3 text-primary underline"
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI specification
            </a>
          </div>
          <p>No operational MCP endpoint or agent credential issuer has been confirmed.</p>
        </EvidenceDisclosure>
      </Panel>
      <Panel>
        <h2 className="section-title">Supplier ordering, live inventory & payments</h2>
        <div className="mt-4">
          <StatusBadge status="CANCELLED" label="Not connected" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Purchases are recorded by the application. No supplier order, payment, EDI/PEPPOL
          submission or live POS synchronization is performed.
        </p>
      </Panel>
    </Page>
  );
}
