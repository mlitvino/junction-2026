"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { useAction } from "@/features/procurement/use-action";
import { HoldToAuthorize } from "./hold-to-authorize";

export function ActionConfirmation({
  title,
  description,
  trigger,
  confirmLabel,
  destructive = false,
  children,
  onConfirm,
  triggerIcon,
  holdToConfirm = false,
}: {
  title: string;
  description: string;
  trigger: string;
  confirmLabel: string;
  destructive?: boolean;
  children?: React.ReactNode;
  onConfirm: () => Promise<void>;
  triggerIcon?: IconName;
  holdToConfirm?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const action = useAction();
  const [session, setSession] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => setConfirmed(false), 550);
    return () => clearTimeout(timer);
  }, [confirmed]);
  return (
    <>
      <Button
        ref={button}
        variant={destructive ? "outline" : "default"}
        className={confirmed ? "luukku-committed" : undefined}
        onClick={() => {
          setSession((value) => value + 1);
          dialog.current?.showModal();
        }}
      >
        {triggerIcon && <Icon name={triggerIcon} className="size-4" />}
        {trigger}
      </Button>
      <dialog
        ref={dialog}
        aria-label={title}
        className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground backdrop:bg-[var(--overlay)]"
        onCancel={(event) => {
          if (action.busy) event.preventDefault();
        }}
        onClose={() => {
          setSession((value) => value + 1);
          button.current?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await onConfirm();
              if (holdToConfirm && !destructive) setConfirmed(true);
              dialog.current?.close();
            });
          }}
        >
          <h2 className="section-title">{title}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{description}</p>
          <div className="mt-6">{children}</div>
          {action.error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {action.error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <Button variant="ghost" disabled={action.busy} onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            {holdToConfirm && !destructive ? (
              <HoldToAuthorize
                key={session}
                label={confirmLabel}
                disabled={action.busy}
                onAuthorize={() => {
                  const form = dialog.current?.querySelector("form");
                  if (dialog.current?.open && !action.busy) form?.requestSubmit();
                }}
              />
            ) : (
              <Button
                type="submit"
                variant={destructive ? "destructive" : "default"}
                disabled={action.busy}
              >
                {action.busy ? "Saving…" : confirmLabel}
              </Button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
