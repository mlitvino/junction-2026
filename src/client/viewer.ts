import type { MeResponse, Role } from "@/shared/contracts/me";

import type { ProvisionalActor, ProvisionalDemoState } from "./provisional/types";

// Who is using the app, as the UI sees it. Connected mode: the signed-in user from GET /api/me.
// Mock mode: the demo role chosen in the account menu. Presentation only: the backend enforces
// real permissions, and the local procurement simulator checks roles for the demo flow.

export type ViewerRole = ProvisionalDemoState["role"];

export type Viewer = {
  id: string;
  displayName: string;
  organizationLabel: string;
  roles: ViewerRole[];
  /** True for the mock-mode demo identity (not authenticated). */
  demo: boolean;
};

export type ViewerState =
  | { status: "loading" }
  | { status: "ready"; viewer: Viewer }
  | { status: "error"; message: string };

/** The one place where backend roles (lowercase) map to UI roles. */
const ROLE_MAP: Record<Role, ViewerRole> = { buyer: "BUYER", approver: "APPROVER" };

export function viewerFromMe(user: MeResponse["user"]): Viewer {
  return {
    id: user.id,
    displayName: user.username,
    organizationLabel: user.organization.name,
    roles: user.roles.map((role) => ROLE_MAP[role]),
    demo: false,
  };
}

export function demoViewer(role: ViewerRole): Viewer {
  return {
    id: `demo-${role.toLowerCase()}`,
    displayName: role === "BUYER" ? "Demo Buyer" : "Demo Approver",
    organizationLabel: "Synthetic demo organization",
    roles: [role],
    demo: true,
  };
}

export const toActor = (viewer: Viewer): ProvisionalActor => ({
  id: viewer.id,
  displayName: viewer.displayName,
  roles: viewer.roles,
});

export function viewerHasRole(state: ViewerState, role: ViewerRole): boolean {
  return state.status === "ready" && state.viewer.roles.includes(role);
}
