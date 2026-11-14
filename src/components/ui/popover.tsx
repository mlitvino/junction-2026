"use client";

import { useId, useState } from "react";
import { cn } from "@/components/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";

// Native auto popovers provide light dismissal, Escape and focus return without a dependency.
export function Popover({
  label,
  icon,
  title,
  children,
  trigger,
  className,
  triggerClassName,
  hideTitle = false,
}: {
  label: string;
  icon: IconName;
  title: string;
  children: React.ReactNode;
  trigger?: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  hideTitle?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size={trigger ? "default" : "icon"}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        className={cn(trigger ? "rounded-full px-2" : undefined, triggerClassName)}
      >
        {trigger ?? <Icon name={icon} />}
      </Button>
      <div
        id={id}
        popover="auto"
        aria-labelledby={`${id}-title`}
        className={cn("shell-popover", className)}
        onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
      >
        <h2 id={`${id}-title`} className={hideTitle ? "sr-only" : "mb-4 font-semibold"}>
          {title}
        </h2>
        {children}
      </div>
    </>
  );
}
