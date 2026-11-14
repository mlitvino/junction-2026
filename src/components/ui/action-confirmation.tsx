"use client";

import { useRef } from "react";
import { Button } from "./button";
import { useAction } from "@/features/procurement/use-action";

export function ActionConfirmation({
  title,
  description,
  trigger,
  confirmLabel,
  destructive = false,
  children,
  onConfirm,
}: {
  title: string;
  description: string;
  trigger: string;
  confirmLabel: string;
  destructive?: boolean;
  children?: React.ReactNode;
  onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const action = useAction();
  return (
    <>
      <Button
        ref={button}
        variant={destructive ? "outline" : "default"}
        onClick={() => dialog.current?.showModal()}
      >
        {trigger}
      </Button>
      <dialog
        ref={dialog}
        aria-label={title}
        className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground backdrop:bg-[var(--overlay)]"
        onCancel={(event) => {
          if (action.busy) event.preventDefault();
        }}
        onClose={() => button.current?.focus()}
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
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="ghost" disabled={action.busy} onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={action.busy}
            >
              {action.busy ? "Saving…" : confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
