import type { Metadata } from "next";
import { ApprovalInbox } from "@/features/approvals/approval-inbox";

export const metadata: Metadata = { title: "Approvals" };
export default function ApprovalsPage() {
  return <ApprovalInbox />;
}
