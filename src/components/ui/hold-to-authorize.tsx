"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Icon } from "./icon";

/** Holding is an input gesture; the form and the server still validate the decision. */
export function HoldToAuthorize({
  label,
  disabled,
  onAuthorize,
}: {
  label: string;
  disabled: boolean;
  onAuthorize: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completed = useRef(false);
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }
  function start() {
    if (disabled || timer.current || completed.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      completed.current = true;
      setHolding(false);
      onAuthorize();
      // Form validation can refuse submission; allow another deliberate attempt.
      completed.current = false;
    }, 800);
  }
  useEffect(() => {
    const cancelHidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancelHidden);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancelHidden);
    };
  }, []);
  return (
    <span className="inline-flex items-center">
      <Button
        type="button"
        disabled={disabled}
        className="luukku-hold min-w-48"
        data-holding={holding}
        aria-label={disabled ? "Saving" : `Hold to ${label.toLowerCase()}`}
        title="Hold for 0.8 seconds. Keyboard: hold Space or Enter."
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
          start();
        }}
        onPointerUp={cancel}
        onPointerMove={(event) => {
          if (!timer.current) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            cancel();
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onBlur={cancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
          if ([" ", "Enter"].includes(event.key)) {
            event.preventDefault();
            if (!event.repeat) start();
          }
        }}
        onKeyUp={(event) => {
          if ([" ", "Enter"].includes(event.key)) {
            event.preventDefault();
            cancel();
          }
        }}
      >
        <Icon name="shield-outline" className="size-4" />
        {disabled ? "Saving…" : holding ? "Authorizing…" : `Hold · ${label}`}
      </Button>
      <span className="sr-only" role="status">
        {holding ? "Keep holding for 0.8 seconds. Release to cancel." : ""}
      </span>
    </span>
  );
}
