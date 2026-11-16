"use client";

import { useEffect, useRef, useState } from "react";

import { AUTH_REQUIRED_EVENT, type AuthPanelMode } from "@/client/auth-panel";
import { Icon } from "@/components/ui/icon";

import { AuthForm } from "./auth-form";

/**
 * The sign-in panel. Pages are public; this modal opens when a guest does something that needs an
 * account (openAuthPanel() from src/client/auth-panel.ts, or any API call answering 401). After
 * signing in or signing up the page reloads, so the workspace loads as that user right where
 * they were.
 */
export function AuthPanel() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<AuthPanelMode>("login");

  useEffect(() => {
    const open = (event: Event) => {
      setMode((event as CustomEvent<AuthPanelMode>).detail ?? "login");
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, open);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, open);
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={mode === "login" ? "Sign in" : "Create account"}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-sm overflow-visible bg-transparent p-0 backdrop:bg-[var(--overlay)]"
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself, outside the card) closes it.
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <div className="relative">
        <button
          type="button"
          aria-label="Close"
          className="absolute top-3 right-3 z-10 rounded-md p-1 text-muted-foreground hover:text-foreground"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" className="size-4" />
        </button>
        <AuthForm key={mode} mode={mode} onSwitch={setMode} onSignedIn={() => window.location.reload()} />
      </div>
    </dialog>
  );
}
