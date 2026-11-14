import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Approvals" };
export default function ApprovalsPage() {
  return (
    <ComingSoon
      title="Approvals"
      icon="approvals"
      description="Review purchase requests that need a human decision, with the details and reasons in one place."
    />
  );
}
