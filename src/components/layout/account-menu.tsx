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
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import type { ShellViewer } from "./navigation";

export function AccountMenu({ viewer }: { viewer?: ShellViewer }) {
  const s = useWorkspace(),
    action = useAction(),
    router = useRouter(),
    [fault, setFault] = useState("none");
  return (
    <Popover
      label="Open account menu"
      icon="user"
      title="Your account"
      trigger={
        <>
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
          >
            {viewer?.displayName.slice(0, 1).toUpperCase() ?? "A"}
          </span>
          <span className="hidden max-w-36 truncate text-label md:inline">
            {viewer?.displayName ?? "Account"}
          </span>
        </>
      }
    >
      <p className="font-semibold break-words">{viewer?.displayName ?? "Loading account…"}</p>
      <p className="mt-2 text-sm text-muted-foreground">{viewer?.organizationLabel}</p>
      <p className="mt-2 text-caption text-muted-foreground">
        {viewer?.roles.map((r) => (r === "BUYER" ? "Buyer" : "Approver")).join(" & ")}
      </p>
      <Link href="/admin/agents" className="mt-4 block min-h-11 py-3 text-sm text-primary">
        Organization preferences
      </Link>
      {apiClient.workspace.mock ? (
        <details className="border-t pt-3 text-sm">
          <summary className="min-h-11 py-3">Development tools</summary>
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
                onClick={() => {
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
        </details>
      ) : (
        <Button
          className="mt-4"
          variant="outline"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await signOut();
              window.location.assign(new URL("/login", window.location.origin).href);
            })
          }
        >
          Sign out
        </Button>
      )}
      {action.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {action.error}
        </p>
      )}
    </Popover>
  );
}
