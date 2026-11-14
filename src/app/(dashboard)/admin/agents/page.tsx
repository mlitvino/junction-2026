import type { Metadata } from "next";
import { AgentRegistry } from "@/features/workspace/settings";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Settings & Administration" };
export default function Page() {
  return (
    <WorkspaceGate>
      <AgentRegistry />
    </WorkspaceGate>
  );
}
