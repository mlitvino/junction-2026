"use client";

import { useEffect, useState } from "react";
import { apiClient } from "./api-client";
import { useWorkspace } from "./use-workspace";

/** The badge uses the count endpoint: the approvals list is capped at 200 records. */
export function usePendingApprovals() {
  const { user, approvals, proposals } = useWorkspace();
  const [result, setResult] = useState<{ userId: string; count: number } | null>(null);
  const canReview = user?.roles.includes("approver");

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = canReview
          ? await apiClient.getPendingApprovalCount()
          : {
              count: proposals.filter(
                (p) =>
                  p.createdBy === userId &&
                  p.approval?.status === "PENDING" &&
                  (!p.quoteExpiresAt || Date.parse(p.quoteExpiresAt) > Date.now()),
              ).length,
              nextExpiresAt: null,
            };
        if (!active) return;
        setResult({ userId, count: value.count });
        clearTimeout(expiryTimer);
        if (value.nextExpiresAt) {
          expiryTimer = setTimeout(
            () => void refresh(),
            Math.min(
              2_147_483_647,
              Math.max(1000, Date.parse(value.nextExpiresAt) - Date.now() + 100),
            ),
          );
        }
      } catch {
        if (active) setResult(null);
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(expiryTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, canReview, approvals, proposals]);

  if (!user) return null;
  return result?.userId === user.id ? result.count : null;
}
