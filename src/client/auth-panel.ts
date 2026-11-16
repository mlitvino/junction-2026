"use client";

// The sign-in panel (src/features/auth/auth-panel.tsx) opens on this window event. Pages are public:
// guests browse freely, and the panel appears when they do something that needs an account, either
// through openAuthPanel() or automatically when an API call answers 401 (src/client/workspace/http.ts
// fires the same event; it stays import-free for its tests, so the name is repeated there).
export const AUTH_REQUIRED_EVENT = "luukku:auth-required";

export type AuthPanelMode = "login" | "signup";

export function openAuthPanel(mode: AuthPanelMode = "login"): void {
  window.dispatchEvent(new CustomEvent<AuthPanelMode>(AUTH_REQUIRED_EVENT, { detail: mode }));
}
