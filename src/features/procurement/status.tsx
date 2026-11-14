import { cn } from "@/components/lib/utils";
import { Icon } from "@/components/ui/icon";
import type { ProvisionalApproval } from "@/client/provisional/types";

export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "success" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-caption font-medium",
        {
          "bg-muted text-foreground": tone === "neutral",
          "bg-warning-surface text-warning": tone === "warning",
          "bg-success-surface text-success": tone === "success",
          "bg-destructive/10 text-destructive": tone === "danger",
        },
      )}
    >
      <Icon name={tone === "success" ? "shield" : "info"} className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
const labels: Record<ProvisionalApproval["status"], string> = {
  PENDING: "Waiting for demo approval",
  APPROVED: "Approved in demo",
  REJECTED: "Rejected in demo",
  EXPIRED: "Demo approval expired",
  SUPERSEDED: "Proposal replaced",
};
export function ApprovalStatus({ status }: { status: ProvisionalApproval["status"] }) {
  return (
    <StatusChip
      tone={
        status === "PENDING"
          ? "warning"
          : status === "APPROVED"
            ? "success"
            : status === "REJECTED"
              ? "danger"
              : "neutral"
      }
    >
      {labels[status]}
    </StatusChip>
  );
}
export function OrderStatus() {
  return <StatusChip tone="success">Simulated order confirmed</StatusChip>;
}
