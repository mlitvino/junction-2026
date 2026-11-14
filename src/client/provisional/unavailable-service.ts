import type { ProvisionalProcurementService, ProvisionalSnapshot } from "./types";
import { ProvisionalApiError } from "./errors";

export function createUnavailableProcurementService(): ProvisionalProcurementService {
  const snapshot: ProvisionalSnapshot = {
    ready: true,
    mode: "unavailable",
    storageNotice: null,
    scenarios: [],
    products: [],
    state: {
      version: 1,
      nextId: 1,
      role: "BUYER",
      activeConversationId: null,
      conversations: [],
      intents: [],
      proposals: [],
      approvals: [],
      orders: [],
      activities: [],
      commits: [],
    },
  };
  const unavailable = async (): Promise<never> => {
    throw new ProvisionalApiError(
      "INTEGRATION_UNAVAILABLE",
      "Procurement integration is not connected. Start the app with NEXT_PUBLIC_USE_MOCKS=true to use the explicitly simulated demo.",
      503,
    );
  };
  return {
    initialize() {},
    subscribe() {
      return () => {};
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    startConversation: unavailable,
    requestApproval: unavailable,
    commitOrder: unavailable,
    decideApproval: unavailable,
    setDemoRole: unavailable,
    resetDemo: unavailable,
  };
}
