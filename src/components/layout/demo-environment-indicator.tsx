import { Icon } from "@/components/ui/icon";

export function DemoEnvironmentIndicator() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
      <Icon name="info" className="size-3.5 shrink-0" />
      <span>
        Demo environment <span aria-hidden="true">·</span> Orders are simulated
      </span>
      <span className="text-caption">Preview only — ordering is not connected.</span>
    </div>
  );
}
