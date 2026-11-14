"use client";

import { useSyncExternalStore } from "react";

import { ApiError, apiClient } from "./api-client";
import { useProcurement } from "./use-procurement";
import { demoViewer, toActor, viewerFromMe, type ViewerState } from "./viewer";

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

// Connected mode: GET /api/me is loaded once per page load and shared by every component.
// Signing in or out does a full navigation (auth-form, account menu), which resets this store.
const LOADING: ViewerState = { status: "loading" };
let state: ViewerState = LOADING;
let started = false;
const listeners = new Set<() => void>();

function set(next: ViewerState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function load() {
  if (started || USE_MOCKS) return;
  started = true;
  apiClient
    .getMe()
    .then(({ user }) => {
      const viewer = viewerFromMe(user);
      apiClient.procurement.setActor(toActor(viewer));
      set({ status: "ready", viewer });
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        // The session expired: sign in again and come back here. A full navigation (not the
        // router) so this store and the simulator start fresh for whoever signs in next.
        const login = new URL("/login", window.location.origin);
        login.searchParams.set("next", window.location.pathname + window.location.search);
        window.location.assign(login.href);
        return;
      }
      started = false;
      set({
        status: "error",
        message: "Couldn't load your account. Refresh the page to try again.",
      });
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

/** Who is using the app: the signed-in user (connected mode) or the demo identity (mock mode). */
export function useViewer(): ViewerState {
  const snapshot = useProcurement();
  const connected = useSyncExternalStore(
    subscribe,
    () => state,
    () => LOADING,
  );
  if (!USE_MOCKS) return connected;
  return snapshot.ready ? { status: "ready", viewer: demoViewer(snapshot.state.role) } : LOADING;
}
