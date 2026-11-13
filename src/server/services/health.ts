import "server-only";

import type { HealthResponse } from "@/shared/contracts/health";

export function getHealth(): HealthResponse {
  return { status: "ok", time: new Date().toISOString() };
}
