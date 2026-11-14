"use client";

import { useSyncExternalStore } from "react";
import { apiClient } from "./api-client";

export function useWorkspace() {
  const store = apiClient.workspace;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
