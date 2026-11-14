"use client";

import { useId } from "react";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { Popover } from "@/components/ui/popover";
import { Icon, type IconName } from "@/components/ui/icon";

const choices: { value: Theme; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const group = useId();
  return (
    <Popover label="Choose theme" icon="sun" title="Appearance">
      <fieldset>
        <legend className="sr-only">Theme preference</legend>
        <div className="space-y-1">
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 hover:bg-accent has-checked:bg-accent has-checked:text-accent-foreground"
            >
              <Icon name={choice.icon} />
              <span className="flex-1">{choice.label}</span>
              <input
                type="radio"
                name={group}
                value={choice.value}
                checked={theme === choice.value}
                onChange={() => setTheme(choice.value)}
                className="size-4 accent-primary"
              />
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-caption text-muted-foreground">
        System follows your device’s appearance.
      </p>
    </Popover>
  );
}
