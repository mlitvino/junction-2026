"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Brand } from "./brand";
import { matchesRoute, visibleNavigation, type ShellViewer } from "./navigation";

export function NavigationLinks({
  viewer,
  onNavigate,
}: {
  viewer?: ShellViewer;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = visibleNavigation(viewer);
  return (
    <nav aria-label="Main navigation" className="space-y-8 px-3 py-6">
      {(["workspace", "administration"] as const).map((group) => {
        const links = items.filter((item) => item.group === group);
        if (!links.length) return null;
        return (
          <div key={group}>
            {group === "administration" && (
              <p className="mb-3 px-3 text-caption text-muted-foreground">Administration</p>
            )}
            <ul className="space-y-1">
              {links.map((item) => {
                const active = matchesRoute(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-label transition-colors",
                        active
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon name={item.icon} className="shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.upcoming && (
                        <span className="text-caption">
                          Soon<span className="sr-only"> — coming soon</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarNote({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const settingsActive =
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/settings/") ||
    matchesRoute(pathname, "/audit") ||
    matchesRoute(pathname, "/integrations");
  return (
    <div className="mt-auto border-t p-3">
      <Link
        href="/admin/agents"
        aria-label="Settings & Administration"
        title="Settings & Administration"
        aria-current={settingsActive ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg bg-muted px-3 py-2 text-caption font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          settingsActive && "bg-accent text-accent-foreground",
        )}
      >
        <Icon name="settings" className="size-[18px] shrink-0" />
        <span className="whitespace-nowrap">Settings &amp; Administration</span>
      </Link>
    </div>
  );
}

export function AppSidebar({ viewer }: { viewer?: ShellViewer }) {
  return (
    <aside
      className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r bg-card lg:flex"
      aria-label="Application sidebar"
    >
      <Brand />
      <NavigationLinks viewer={viewer} />
      <SidebarNote />
    </aside>
  );
}
