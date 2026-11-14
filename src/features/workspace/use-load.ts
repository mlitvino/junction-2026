"use client";
import { useEffect, useEffectEvent, useState } from "react";

export function useLoad(load: () => Promise<unknown>, resourceKey: string) {
  const [error, setError] = useState<unknown>(null);
  const fetchResource = useEffectEvent(() => {
    void load()
      .then(() => setError(null))
      .catch(setError);
  });
  useEffect(() => {
    fetchResource();
  }, [resourceKey]);
  return error;
}
