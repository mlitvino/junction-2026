"use client";

import { useWorkspace } from "./use-workspace";
import { viewerFromMe, type ViewerState } from "./viewer";

export function useViewer(): ViewerState {
  const snapshot = useWorkspace();
  if (!snapshot.ready) return { status: "loading" };
  if (!snapshot.user) return { status: "error", message: snapshot.error ?? "Sign in to continue." };
  return {
    status: "ready",
    viewer: { ...viewerFromMe(snapshot.user), demo: process.env.NEXT_PUBLIC_USE_MOCKS === "true" },
  };
}
