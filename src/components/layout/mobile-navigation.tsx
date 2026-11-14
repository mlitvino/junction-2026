"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Brand } from "./brand";
import { NavigationLinks, SidebarNote } from "./app-sidebar";
import type { ShellViewer } from "./navigation";

export function MobileNavigation({ viewer }: { viewer?: ShellViewer }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousOverflow = useRef("");
  function close() {
    dialog.current?.close();
  }
  function open() {
    previousOverflow.current = document.body.style.overflow;
    dialog.current?.showModal();
    document.body.style.overflow = "hidden";
  }
  useEffect(() => {
    const navigationDialog = dialog.current;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => {
      if (desktop.matches) navigationDialog?.close();
    };
    desktop.addEventListener("change", onResize);
    return () => {
      desktop.removeEventListener("change", onResize);
      if (navigationDialog?.open) document.body.style.overflow = previousOverflow.current;
    };
  }, []);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={open}
        className="lg:hidden"
      >
        <Icon name="menu" />
      </Button>
      <dialog
        ref={dialog}
        id={id}
        aria-label="Navigation"
        className="mobile-navigation"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button:not(:disabled)",
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClick={(event) => {
          if (
            event.target === event.currentTarget &&
            event.clientX >= event.currentTarget.getBoundingClientRect().right
          )
            close();
        }}
        onClose={() => {
          document.body.style.overflow = previousOverflow.current;
          trigger.current?.focus();
        }}
      >
        <div className="flex min-h-full flex-col">
          <div className="flex items-center justify-between border-b">
            <Brand onNavigate={close} />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close navigation"
              onClick={close}
              className="mr-2"
            >
              <Icon name="close" />
            </Button>
          </div>
          <NavigationLinks viewer={viewer} onNavigate={close} />
          <SidebarNote onNavigate={close} />
        </div>
      </dialog>
    </>
  );
}
