import { Suspense } from "react";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { MobileTabs } from "./mobile-tabs";
import type { ShellViewer } from "./navigation";

export function AppShell({
  children,
  viewer,
}: {
  children: React.ReactNode;
  viewer?: ShellViewer;
}) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-50 -translate-y-24 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <Suspense
        fallback={<aside className="hidden w-[248px] shrink-0 border-r bg-card lg:block" />}
      >
        <AppSidebar viewer={viewer} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 bg-background">
          <Suspense fallback={<div className="h-16 border-b" />}>
            <AppHeader viewer={viewer} />
          </Suspense>
        </div>
        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 flex-col p-4 pb-28 md:p-6 md:pb-28 lg:p-8"
        >
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <MobileTabs />
      </Suspense>
    </div>
  );
}
