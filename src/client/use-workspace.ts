"use client";

import { useSyncExternalStore } from "react";
import { apiClient } from "./api-client";

export function useWorkspace() {
  const store = apiClient.workspace;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

/**
 * May the visitor try an action that needs `role`? A guest may (the action then asks them to sign
 * in, see src/client/auth-panel.ts); a signed-in user only with the role. Presentation only: the
 * backend checks every request.
 */
export function mayAttempt(
  s: { ready: boolean; user?: { roles: readonly string[] } | null; error?: string | null },
  role: "buyer" | "approver",
): boolean {
  if (s.ready && !s.user && !s.error) return true;
  return !!s.user?.roles.includes(role);
}
