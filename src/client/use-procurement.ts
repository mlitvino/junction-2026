"use client";

import { useSyncExternalStore } from "react";
import { apiClient } from "./api-client";
import type { ProvisionalSnapshot } from "./provisional/types";

export function useProcurement() {
  const service = apiClient.procurement;
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getServerSnapshot);
}

/** The local procurement simulator is loaded and usable (mock or connected mode). */
export function simulatorAvailable(snapshot: ProvisionalSnapshot): boolean {
  return snapshot.ready && snapshot.mode !== "unavailable";
}
