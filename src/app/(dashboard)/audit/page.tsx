import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Audit" };
export default function AuditPage() {
  return (
    <ComingSoon
      title="Activity & Audit"
      icon="audit"
      description="Follow purchasing decisions and understand what happened, who acted, and why."
    />
  );
}
