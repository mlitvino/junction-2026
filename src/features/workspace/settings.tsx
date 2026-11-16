"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { mayAttempt, useWorkspace } from "@/client/use-workspace";
import type { AuditEvent } from "@/shared/contracts/purchasing";
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
              {mayAttempt(s, "approver") ? "Manage policies" : "View preferences"}
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
export { Policies } from "./purchasing-policies";

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
      {!mayAttempt(s, "approver") ? (
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
    action = useAction(),
    [query, setQuery] = useState(""),
    [serverEvents, setServerEvents] = useState<AuditEvent[]>([]),
    [auditError, setAuditError] = useState<unknown>(null);
  const approver = !!s.user?.roles.includes("approver");
  const fetchAudit = useCallback(async () => {
    if (store.mock || !s.user) return [];
    if (approver) return (await store.api.listAudit({ limit: 100 })).items;
    const results = await Promise.allSettled(
      s.proposals.slice(0, 10).map((p) => store.api.getProposalAudit(p.id)),
    );
    const map = new Map<string, AuditEvent>();
    for (const res of results)
      if (res.status === "fulfilled") for (const item of res.value.items) map.set(item.id, item);
    return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [approver, s.proposals, s.user]);
  useEffect(() => {
    let active = true;
    fetchAudit()
      .then((items) => {
        if (!active) return;
        setServerEvents(items);
        setAuditError(null);
      })
      .catch((error: unknown) => {
        if (active) setAuditError(error);
      });
    return () => {
      active = false;
    };
  }, [fetchAudit]);
  const events = store.mock
    ? s.local.activities
        .filter((e) => `${e.text} ${e.resourceId}`.toLowerCase().includes(query.toLowerCase()))
        .map((e) => ({
          id: e.id,
          at: e.at,
          text: e.text,
          resourceId: e.resourceId,
          detail: e.detail || "No additional details were recorded.",
        }))
    : serverEvents
        .filter((e) =>
          `${e.summary} ${e.action} ${e.resourceType} ${e.resourceId} ${e.actorName ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((e) => ({
          id: e.id,
          at: e.createdAt,
          text: `${e.summary}${e.actorName ? ` · ${e.actorName} (${e.actorType})` : ` · ${e.actorType}`}`,
          resourceId: `${e.resourceType}:${e.resourceId}`,
          detail: `${e.action} · ${JSON.stringify(e.details)}`,
        }));
  return (
    <Page
      title="Activity & Audit"
      description={
        store.mock
          ? "Understand the purchasing decisions observed in this workspace."
          : approver
            ? "Organization-wide audit trail of proposals, approvals, orders, preferences and members."
            : "Audit trail for your recent purchasing proposals."
      }
      wide
      action={
        !store.mock && (
          <Button
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                setServerEvents(await fetchAudit());
                setAuditError(null);
              })
            }
          >
            Refresh
          </Button>
        )
      }
    >
      <AdminNavigation />
      <ErrorMessage error={auditError || action.error} />
      <input
        type="search"
        className={inputClass}
        aria-label="Search activity"
        placeholder="Search activity or reference"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {action.busy && !events.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading audit trail…
        </p>
      ) : !events.length ? (
        <EmptyState title="No matching activity yet">
          {store.mock
            ? "Prepare or review a purchase to start its local activity history."
            : "Prepare or review a purchase to record events in the organization audit log."}
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
                <p className="break-words">{event.detail}</p>
                <p className="break-all text-caption">Reference: {event.resourceId}</p>
              </EvidenceDisclosure>
            </Panel>
          ))}
        </div>
      )}
      <EvidenceDisclosure title="Activity scope">
        <p>
          {store.mock
            ? "This view contains events observed in this browser. Organization-wide audit retrieval, durable event attribution and external agent logs are not connected."
            : approver
              ? "Loaded from the insert-only organization audit log (GET /api/audit). Proposals and orders also carry SHA-256 content hashes and Ed25519 signatures."
              : "Shows recorded proposal audit events (GET /api/proposals/{id}/audit). Organization-wide preference and member audit requires the Approver role."}
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
