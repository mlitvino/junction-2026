import type { Metadata } from "next";
import { AssistantWelcome } from "@/features/workspace/assistant";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Assistant" };
export default function Page() {
  return (
    <WorkspaceGate>
      <AssistantWelcome />
    </WorkspaceGate>
  );
}
