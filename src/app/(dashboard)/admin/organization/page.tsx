import type { Metadata } from "next";
import { Organization } from "@/features/workspace/settings";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Organization" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Organization />
    </WorkspaceGate>
  );
}
