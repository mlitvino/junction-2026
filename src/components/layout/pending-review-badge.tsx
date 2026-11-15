"use client";

import { usePendingApprovals } from "@/client/use-pending-approvals";

export function PendingReviewBadge() {
  const count = usePendingApprovals();
  if (count === null) return null;
  return (
    <span
      aria-label={`${count} purchases waiting for approval`}
      className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-accent-foreground"
    >
      {count}
    </span>
  );
}
