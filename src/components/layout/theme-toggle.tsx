"use client";

import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle color theme"
      title="Switch between light and dark themes"
      onClick={() =>
        setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")
      }
    >
      <span className="relative block size-5" aria-hidden="true">
        <Icon
          name="sun"
          className="absolute inset-0 rotate-0 scale-100 opacity-100 transition-[transform,rotate,scale,opacity] duration-200 ease-out dark:-rotate-90 dark:scale-50 dark:opacity-0 motion-reduce:transition-none"
        />
        <Icon
          name="moon"
          className="absolute inset-0 rotate-90 scale-50 opacity-0 transition-[transform,rotate,scale,opacity] duration-200 ease-out dark:rotate-0 dark:scale-100 dark:opacity-100 motion-reduce:transition-none"
        />
      </span>
    </Button>
  );
}
