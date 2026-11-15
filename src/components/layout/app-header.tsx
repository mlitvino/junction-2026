"use client";

import { usePathname } from "next/navigation";
import { AccountMenu } from "./account-menu";
import { MobileNavigation } from "./mobile-navigation";
import { navigationItems, matchesRoute, type ShellViewer } from "./navigation";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader({ viewer }: { viewer?: ShellViewer }) {
  const pathname = usePathname();
  const context = pathname.startsWith("/proposals/")
    ? "Purchase Proposal"
    : pathname.startsWith("/checkout/")
      ? "Checkout"
      : (navigationItems.find((item) => matchesRoute(pathname, item.href))?.context ?? "Assistant");
  return (
    <header className="luukku-header flex h-16 shrink-0 items-center justify-between gap-2 border-b px-2 md:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNavigation viewer={viewer} />
        <span className="truncate text-label font-medium" title={context}>
          {context}
        </span>
      </div>
      <div
        className="flex shrink-0 items-center gap-0 md:gap-1"
        aria-label="Account and appearance controls"
      >
        <ThemeToggle />
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border md:mx-3" />
        <AccountMenu viewer={viewer} />
      </div>
    </header>
  );
}
