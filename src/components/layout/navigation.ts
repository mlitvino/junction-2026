import type { IconName } from "@/components/ui/icon";

// Presentation props only, not an authentication contract or an authorization boundary.
// Map the agreed session DTO here once it is available via api-client.
export type ShellViewer = {
  displayName: string;
  organizationLabel?: string;
  roles: readonly string[];
  demo?: boolean;
};

type NavigationItem = {
  href: string;
  label: string;
  context: string;
  icon: IconName;
  group: "workspace" | "administration";
  roles: readonly string[];
  upcoming?: boolean;
};

export const navigationItems: readonly NavigationItem[] = [
  {
    href: "/buyer",
    label: "Workspace",
    context: "Buyer Workspace",
    icon: "workspace",
    group: "workspace",
    roles: ["BUYER"],
  },
  {
    href: "/approvals",
    label: "Approvals",
    context: "Approvals",
    icon: "approvals",
    group: "workspace",
    roles: ["APPROVER", "ADMIN"],
  },
  {
    href: "/orders",
    label: "Orders",
    context: "Orders",
    icon: "orders",
    group: "workspace",
    roles: ["BUYER", "APPROVER", "ADMIN"],
  },
  {
    href: "/admin/agents",
    label: "Agents & Policies",
    context: "Agent Management",
    icon: "agents",
    group: "administration",
    roles: ["ADMIN"],
    upcoming: true,
  },
  {
    href: "/audit",
    label: "Activity & Audit",
    context: "Audit",
    icon: "audit",
    group: "administration",
    roles: ["BUYER", "APPROVER", "ADMIN"],
    upcoming: true,
  },
  {
    href: "/integrations",
    label: "Integrations",
    context: "Integrations",
    icon: "integrations",
    group: "administration",
    roles: ["BUYER", "APPROVER", "ADMIN"],
    upcoming: true,
  },
];

export function matchesRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function visibleNavigation(viewer?: ShellViewer) {
  // No identity is claimed in the frontend preview. Authenticated users get role-filtered links.
  return viewer
    ? navigationItems.filter((item) => item.roles.some((role) => viewer.roles.includes(role)))
    : navigationItems;
}
