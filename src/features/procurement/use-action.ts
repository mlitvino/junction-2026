"use client";

import { useRef, useState } from "react";

export function useAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The operation could not be completed.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error };
}
