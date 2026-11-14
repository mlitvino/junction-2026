"use client";

import { useSyncExternalStore } from "react";
import { apiClient } from "./api-client";

export function useProcurement() {
  const service = apiClient.procurement;
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getServerSnapshot);
}
