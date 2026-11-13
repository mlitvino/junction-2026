import type { HealthResponse } from "@/shared/contracts/health";

export const healthMock = (): HealthResponse => ({
  status: "ok",
  time: new Date().toISOString(),
});
