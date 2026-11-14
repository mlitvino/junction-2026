"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/client/api-client";
import { useWorkspace } from "@/client/use-workspace";
import { signOut } from "@/client/auth-client";
import { useAction } from "@/features/procurement/use-action";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import type { ShellViewer } from "./navigation";

export function AccountMenu({ viewer }: { viewer?: ShellViewer }) {
  const s = useWorkspace(),
    action = useAction(),
    router = useRouter(),
    [fault, setFault] = useState("none");
  const displayName = viewer?.displayName ?? "Account";
  const initials =
    displayName
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "A";
  function closeMenu(target: HTMLElement) {
    target.closest<HTMLElement>("[popover]")?.hidePopover();
  }
  return (
    <Popover
      label="Open account menu"
      icon="user"
      title="Your account"
      hideTitle
      className="top-16 right-2 w-[22rem] overscroll-contain rounded-2xl p-2 md:right-6 lg:right-8"
      triggerClassName="group gap-2.5 rounded-xl border border-transparent px-1.5 py-1 text-foreground aria-expanded:border-border aria-expanded:bg-card md:px-2.5"
      trigger={
        <>
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-label font-semibold text-primary transition-colors group-aria-expanded:bg-primary group-aria-expanded:text-primary-foreground"
          >
            {initials}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium md:inline">
            {displayName}
          </span>
          <Icon
            name="sliders"
            className="invisible hidden size-[18px] shrink-0 text-muted-foreground group-aria-expanded:visible md:block"
          />
        </>
      }
    >
      <div className="px-4 py-4">
        <p className="break-words text-base font-medium leading-6">
          {viewer?.displayName ?? "Loading account…"}
        </p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {viewer?.roles.map((r) => (r === "BUYER" ? "Buyer" : "Approver")).join(" & ")}
        </p>
        {viewer?.organizationLabel && (
          <p className="mt-1 break-words text-caption text-muted-foreground">
            {viewer.organizationLabel}
          </p>
        )}
      </div>
      <div className="border-t py-1">
        <Link
          href="/admin/agents"
          onClick={(event) => closeMenu(event.currentTarget)}
          className="flex min-h-12 items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Icon name="sliders" className="shrink-0 text-muted-foreground" /> Organization
          preferences
        </Link>
      </div>
      {apiClient.workspace.mock ? (
        <details className="group/dev border-t text-sm">
          <summary className="flex min-h-12 cursor-pointer list-none items-start gap-3 rounded-lg px-4 py-4 transition-colors hover:bg-muted">
            <Icon name="shield-outline" className="mt-0.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-2 font-medium leading-6">
                <span>Development tools</span>
                <Icon
                  name="chevron"
                  className="size-3.5 transition-transform group-open/dev:rotate-90 motion-reduce:transition-none"
                />
              </span>
              <span className="mt-1 block text-caption leading-5 text-muted-foreground">
                Switch active role &amp; testing tools
              </span>
            </span>
          </summary>
          <div className="px-4 pb-4 pt-1">
            <p className="mb-4 text-caption text-muted-foreground">
              Local capability controls are not authentication. No supplier orders or payments are
              sent.
            </p>
            <label className="block text-label">
              Capabilities
              <select
                aria-label="Capabilities"
                className="mt-2 min-h-11 w-full rounded-md border bg-card p-2"
                value={s.user?.roles.length === 2 ? "both" : (s.user?.roles[0] ?? "buyer")}
                onChange={(e) =>
                  void action.run(() =>
                    apiClient.workspace.setRoles(
                      e.target.value === "both"
                        ? ["buyer", "approver"]
                        : [e.target.value as "buyer" | "approver"],
                    ),
                  )
                }
              >
                <option value="both">Buyer & Approver</option>
                <option value="buyer">Buyer only</option>
                <option value="approver">Approver only</option>
              </select>
            </label>
            <label className="mt-4 block text-label">
              Quote condition
              <select
                aria-label="Quote condition"
                className="mt-2 min-h-11 w-full rounded-md border bg-card p-2"
                value={fault}
                onChange={(e) => {
                  const value = e.target.value as "none" | "price" | "expired";
                  setFault(value);
                  apiClient.workspace.setFault(value);
                }}
              >
                <option value="none">Current quote</option>
                <option value="price">Price changes at ordering</option>
                <option value="expired">Expired quote at ordering</option>
              </select>
            </label>
            <div className="my-4 space-y-2">
              {[
                "Order 100 litres of lactose-free milk",
                "Order 400 litres of lactose-free milk",
                "Order milk-protein-free oat drink",
                "Plan macaroni for 1,000 portions",
                "Restock cheese to target",
              ].map((text) => (
                <Button
                  key={text}
                  variant="ghost"
                  className="h-auto w-full whitespace-normal text-left"
                  onClick={(event) => {
                    closeMenu(event.currentTarget);
                    apiClient.workspace.draft("welcome", text);
                    router.push("/buyer");
                  }}
                >
                  {text}
                </Button>
              ))}
            </div>
            <ActionConfirmation
              title="Reset development workspace?"
              description="Clear local conversations, plans and purchasing reference data. This does not affect a connected organization."
              trigger="Reset development workspace"
              confirmLabel="Reset workspace"
              destructive
              onConfirm={() => apiClient.workspace.reset()}
            />
          </div>
        </details>
      ) : (
        <div className="border-t py-1">
          <Button
            className="min-h-12 w-full justify-start gap-3 rounded-lg px-4 py-3 text-foreground hover:text-destructive"
            variant="ghost"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await signOut();
                window.location.assign(new URL("/login", window.location.origin).href);
              })
            }
          >
            <Icon name="log-out" className="shrink-0 text-muted-foreground" /> Sign out
          </Button>
        </div>
      )}
      {action.error && (
        <p role="alert" className="px-4 pb-3 pt-2 text-sm text-destructive">
          {action.error}
        </p>
      )}
    </Popover>
  );
}
