import type { Metadata } from "next";
import { Restocking } from "@/features/workspace/restocking";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Restocking" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Restocking />
    </WorkspaceGate>
  );
}
