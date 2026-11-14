"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { themeStorageKey as storageKey } from "./theme-config";

export type Theme = "light" | "dark" | "system";
const changeEvent = "aimo-theme-change";

function getTheme(): Theme {
  const value = document.documentElement.dataset.themePreference;
  return value === "light" || value === "dark" ? value : "system";
}

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.themePreference = theme;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const syncSystem = () => applyTheme(getTheme());
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    const value = event.newValue;
    applyTheme(value === "light" || value === "dark" ? value : "system");
    onChange();
  };
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", syncStorage);
  media.addEventListener("change", syncSystem);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", syncStorage);
    media.removeEventListener("change", syncSystem);
  };
}

function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    /* Switching still works without storage. */
  }
  window.dispatchEvent(new Event(changeEvent));
}

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "system" as const);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
