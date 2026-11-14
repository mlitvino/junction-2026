import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Integrations" };
export default function IntegrationsPage() {
  return (
    <ComingSoon
      title="Integrations"
      icon="integrations"
      description="Explore supported connections and agent interfaces when integration features are available."
    />
  );
}
