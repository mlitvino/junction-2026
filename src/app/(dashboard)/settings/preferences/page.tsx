import type { Metadata } from "next";
import { Policies } from "@/features/workspace/settings";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Purchasing preferences" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Policies />
    </WorkspaceGate>
  );
}
