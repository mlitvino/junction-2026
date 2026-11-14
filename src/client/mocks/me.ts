import type { MeResponse } from "@/shared/contracts/me";

export const meMock = (): MeResponse => ({
  user: {
    id: "mock-user-id",
    username: "demo",
    organization: { id: "mock-org-id", name: "demo's organization" },
    roles: ["buyer", "approver"],
  },
});
