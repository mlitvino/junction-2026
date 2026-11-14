"use client";

import { useProcurement } from "@/client/use-procurement";
import { AppShell } from "./app-shell";

export function DemoAppShell({ children }: { children: React.ReactNode }) {
  const snapshot = useProcurement();
  const viewer =
    snapshot.ready && snapshot.mode === "mock"
      ? {
          displayName: snapshot.state.role === "BUYER" ? "Demo Buyer" : "Demo Approver",
          organizationLabel: "Synthetic demo organization",
          roles: [snapshot.state.role],
          demo: true,
        }
      : undefined;
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
