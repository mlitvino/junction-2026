import type { IconName } from "@/components/ui/icon";
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
    label: "Assistant",
    context: "Assistant",
    icon: "workspace",
    group: "workspace",
    roles: ["BUYER", "APPROVER"],
  },
  {
    href: "/approvals",
    label: "To review",
    context: "To review",
    icon: "approvals",
    group: "workspace",
    roles: ["BUYER", "APPROVER"],
  },
  {
    href: "/restocking",
    label: "Restocking",
    context: "Restocking",
    icon: "restocking",
    group: "workspace",
    roles: ["BUYER", "APPROVER"],
  },
  {
    href: "/recipes",
    label: "Recipes",
    context: "Recipes",
    icon: "recipes",
    group: "workspace",
    roles: ["BUYER", "APPROVER"],
  },
  {
    href: "/orders",
    label: "Orders",
    context: "Orders",
    icon: "orders",
    group: "workspace",
    roles: ["BUYER", "APPROVER"],
  },
  {
    href: "/admin/agents",
    label: "Settings & Administration",
    context: "Settings & Administration",
    icon: "settings",
    group: "administration",
    roles: ["BUYER", "APPROVER"],
  },
  {
    href: "/admin/organization",
    label: "Organization",
    context: "Organization",
    icon: "user",
    group: "administration",
    roles: ["APPROVER"],
  },
  {
    href: "/audit",
    label: "Activity & Audit",
    context: "Activity & Audit",
    icon: "audit",
    group: "administration",
    roles: ["BUYER", "APPROVER"],
  },
  {
    href: "/integrations",
    label: "Integrations",
    context: "Integrations",
    icon: "integrations",
    group: "administration",
    roles: ["BUYER", "APPROVER"],
  },
];
export function matchesRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
export function visibleNavigation(viewer?: ShellViewer) {
  return navigationItems.filter(
    (item) =>
      item.group === "workspace" &&
      (!viewer || item.roles.some((role) => viewer.roles.includes(role))),
  );
}
