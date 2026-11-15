import { createHttpApi, ApiError } from "./workspace/http";
import { createMockApi } from "./workspace/mock-api";
import { createWorkspaceService } from "./workspace/service";
import { createMockProcurementService } from "./mocks/mock-service";
import { createUnavailableProcurementService } from "./provisional/unavailable-service";
import { announceTrustAgentFeedback } from "./trust-agent-feedback";

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";
const local = USE_MOCKS ? createMockApi() : null;
const domain = local?.api ?? createHttpApi();

export { ApiError };
export const apiClient = {
  ...domain,
  workspace: createWorkspaceService(domain, {
    mock: USE_MOCKS,
    capabilities: local ?? undefined,
    onPurchaseConfirmed: announceTrustAgentFeedback,
  }),
  // Compatibility for the archived Task 2 components/tests. Never used for connected purchasing.
  procurement: USE_MOCKS
    ? createMockProcurementService({
        storage: () => (typeof window === "undefined" ? null : sessionStorage),
      })
    : createUnavailableProcurementService(),
};
