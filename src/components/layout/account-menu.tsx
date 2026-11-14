"use client";

import { useId } from "react";
import { apiClient } from "@/client/api-client";
import { useProcurement } from "@/client/use-procurement";
import { useAction } from "@/features/procurement/use-action";
import { ActionConfirmation } from "@/components/ui/action-confirmation";
import { Popover } from "@/components/ui/popover";
import type { ShellViewer } from "./navigation";

export function AccountMenu({ viewer }: { viewer?: ShellViewer }) {
  const snapshot = useProcurement();
  const action = useAction();
  const selectId = useId();
  return (
    <Popover label="Open account menu" icon="user" title="Your account">
      {snapshot.ready && snapshot.mode === "mock" ? (
        <div className="space-y-4">
          <label htmlFor={selectId} className="block text-label font-medium">
            Demo identity (UI simulation)
          </label>
          <select
            id={selectId}
            value={snapshot.state.role}
            disabled={action.busy}
            onChange={(event) => {
              const role = event.target.value;
              if (role === "BUYER" || role === "APPROVER")
                void action.run(() => apiClient.procurement.setDemoRole(role));
            }}
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="BUYER">Demo Buyer</option>
            <option value="APPROVER">Demo Approver</option>
          </select>
          <p className="text-caption text-muted-foreground">
            For testing in this tab only. This is not authentication or authorization.
          </p>
          {action.error && (
            <p role="alert" className="text-sm text-destructive">
              {action.error}
            </p>
          )}
          <div className="border-t pt-4">
            <ActionConfirmation
              title="Reset local demo?"
              description="This clears the synthetic conversations, approvals and orders in this tab and stops any running demonstration."
              trigger="Reset local demo"
              confirmLabel="Reset demo"
              destructive
              onConfirm={() => apiClient.procurement.resetDemo()}
            />
          </div>
        </div>
      ) : (
        <>
          {viewer ? (
            <>
              <p className="break-words font-medium">{viewer.displayName}</p>
              {viewer.organizationLabel && (
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {viewer.organizationLabel}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-medium">Account not connected</p>
              <p className="mt-2 text-sm text-muted-foreground">
                You’re viewing the frontend preview. Sign-in and account controls are coming in a
                later milestone.
              </p>
            </>
          )}
        </>
      )}
    </Popover>
  );
}
