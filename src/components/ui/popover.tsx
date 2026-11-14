"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";

// Native auto popovers provide light dismissal, Escape and focus return without a dependency.
export function Popover({
  label,
  icon,
  title,
  children,
  trigger,
}: {
  label: string;
  icon: IconName;
  title: string;
  children: React.ReactNode;
  trigger?: React.ReactNode;
}) {
  const id = useId();
  return (
    <>
      <Button
        variant="ghost"
        size={trigger ? "default" : "icon"}
        aria-label={label}
        title={label}
        popoverTarget={id}
        className={trigger ? "rounded-full px-2" : undefined}
      >
        {trigger ?? <Icon name={icon} />}
      </Button>
      <div id={id} popover="auto" aria-labelledby={`${id}-title`} className="shell-popover">
        <h2 id={`${id}-title`} className="mb-4 font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </>
  );
}
