"use client";

import { useViewer } from "@/client/use-viewer";
import { AppShell } from "./app-shell";

// The viewer is the signed-in user in connected mode (GET /api/me) or the demo identity in
// mock mode; see src/client/use-viewer.ts.
export function DemoAppShell({ children }: { children: React.ReactNode }) {
  const viewer = useViewer();
  return (
    <AppShell viewer={viewer.status === "ready" ? viewer.viewer : undefined}>
      {viewer.status === "error" ? (
        <p role="alert" className="py-12 text-center text-destructive">
          {viewer.message}
        </p>
      ) : (
        children
      )}
    </AppShell>
  );
}
