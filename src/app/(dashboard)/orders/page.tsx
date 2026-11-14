import type { Metadata } from "next";
import { Orders } from "@/features/workspace/purchasing-pages";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Orders" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Orders />
    </WorkspaceGate>
  );
}
