import type { Metadata } from "next";
import { Integrations } from "@/features/workspace/settings";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Integrations" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Integrations />
    </WorkspaceGate>
  );
}
