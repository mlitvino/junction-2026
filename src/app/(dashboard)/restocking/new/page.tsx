import type { Metadata } from "next";
import { RestockEditor } from "@/features/workspace/restocking";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Create restock plan" };
export default function Page() {
  return (
    <WorkspaceGate>
      <RestockEditor />
    </WorkspaceGate>
  );
}
