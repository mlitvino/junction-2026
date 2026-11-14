"use client";
import Link from "next/link";
import { useWorkspace } from "@/client/use-workspace";
import { Popover } from "@/components/ui/popover";
export function NotificationsPopover() {
  const s = useWorkspace();
  const pending = s.user?.roles.includes("approver")
    ? s.approvals.filter((a) => a.status === "PENDING")
    : [];
  return (
    <Popover label="Open notifications" icon="bell" title="Notifications">
      {pending.length ? (
        <>
          <p className="text-sm">
            {pending.length} purchase{pending.length === 1 ? "" : "s"} need your review.
          </p>
          <ul className="mt-4 divide-y">
            {pending.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link
                  className="block min-h-11 py-3 text-sm text-primary"
                  href={`/approvals/${a.id}`}
                >
                  {a.proposal.lines[0]?.name ?? "Purchase request"}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No purchasing updates to show.</p>
      )}
      <p className="mt-4 text-caption text-muted-foreground">
        Review requests come from the purchasing list. Persistent notification delivery is not
        connected.
      </p>
    </Popover>
  );
}
