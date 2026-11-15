"use client";

import { useEffect, useRef, useState } from "react";

export function AnimatedPrice({
  value,
  currency = "EUR",
}: {
  value: number | null | undefined;
  currency?: string;
}) {
  const [displayed, setDisplayed] = useState(value ?? 0);
  const current = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return;
    const from = current.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame: number;
    const update = (at: number) => {
      const progress = reduced ? 1 : Math.min(1, (at - started) / 320);
      current.current = from + (value - from) * (1 - Math.pow(1 - progress, 3));
      setDisplayed(current.current);
      if (progress < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span
      className="tabular-nums"
      aria-label={
        value == null
          ? "Price unavailable"
          : new Intl.NumberFormat("en-FI", { style: "currency", currency }).format(value)
      }
    >
      <span aria-hidden="true">
        {value == null
          ? "Price unavailable"
          : new Intl.NumberFormat("en-FI", { style: "currency", currency }).format(displayed)}
      </span>
    </span>
  );
}
