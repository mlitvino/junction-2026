import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Agent Management" };
export default function AgentsPage() {
  return (
    <ComingSoon
      title="Agent Management"
      icon="agents"
      description="Manage purchasing agents and the policies that define what they can do on your behalf."
    />
  );
}
