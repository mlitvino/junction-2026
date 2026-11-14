"use client";

import { useProcurement } from "@/client/use-procurement";
import { Icon } from "@/components/ui/icon";

export function DemoEnvironmentIndicator() {
  const snapshot = useProcurement();
  const mock = snapshot.mode === "mock";
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
      <Icon name="info" className="size-3.5 shrink-0" />
      <span>
        {mock ? "Demo data · Local simulated orders" : "Frontend preview · Integration unavailable"}
      </span>
      <span className="text-caption">No orders are submitted to Valio.</span>
    </div>
  );
}
