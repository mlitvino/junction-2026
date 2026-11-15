import "server-only";

import { valioSource } from "@/server/valio/client";
import type { HealthResponse } from "@/shared/contracts/health";

export function getHealth(): HealthResponse {
  return { status: "ok", time: new Date().toISOString(), valio: valioSource() === "valio" ? "live" : "mock" };
}
