import type { MeResponse } from "@/shared/contracts/me";

export const meMock = (): MeResponse => ({
  user: { id: "mock-user-id", username: "demo" },
});
