import type { Metadata } from "next";
import { Inventory } from "@/features/workspace/restocking";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Kitchen stock" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Inventory />
    </WorkspaceGate>
  );
}
