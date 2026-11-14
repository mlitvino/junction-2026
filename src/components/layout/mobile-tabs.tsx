"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { navigationItems, matchesRoute } from "./navigation";
export function MobileTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {navigationItems
        .filter((i) => i.group === "workspace")
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={matchesRoute(pathname, item.href) ? "page" : undefined}
            className={`flex min-h-18 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-1 text-[11px] ${matchesRoute(pathname, item.href) ? "text-primary" : "text-muted-foreground"}`}
          >
            <Icon name={item.icon} className="size-5" />
            <span>{item.label}</span>
          </Link>
        ))}
    </nav>
  );
}
