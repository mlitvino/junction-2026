import type { Metadata } from "next";
import { Audit } from "@/features/workspace/settings";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Activity & Audit" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Audit />
    </WorkspaceGate>
  );
}
