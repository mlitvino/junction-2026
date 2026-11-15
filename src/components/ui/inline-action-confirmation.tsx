"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "@/features/procurement/use-action";
import { Button } from "./button";
import { HoldToAuthorize } from "./hold-to-authorize";
import { Icon, type IconName } from "./icon";

export function InlineActionConfirmation({
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
  const [open, setOpen] = useState(false);
  const action = useAction();
  const triggerButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (open) form.current?.focus();
  }, [open]);
  function close() {
    setOpen(false);
    triggerButton.current?.focus();
  }
  return (
    <>
      <Button
        ref={triggerButton}
        variant={destructive ? "outline" : "default"}
        disabled={action.busy}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {triggerIcon && <Icon name={triggerIcon} className="size-4" />}
        {trigger}
      </Button>
      {open && (
        <form
          ref={form}
          role="region"
          aria-label={title}
          tabIndex={-1}
          className="luukku-chamber order-last w-full basis-full rounded-xl border p-4 text-left sm:p-5"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !action.busy) {
              event.stopPropagation();
              close();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(async () => {
              await onConfirm();
              close();
            });
          }}
        >
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
          {children && <div className="mt-4">{children}</div>}
          {action.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {action.error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <Button variant="ghost" disabled={action.busy} onClick={close}>
              Cancel
            </Button>
            {holdToConfirm && !destructive ? (
              <HoldToAuthorize
                label={confirmLabel}
                disabled={action.busy}
                onAuthorize={() => {
                  if (!action.busy) form.current?.requestSubmit();
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
      )}
    </>
  );
}
