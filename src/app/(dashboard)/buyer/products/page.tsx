import type { Metadata } from "next";
import { ManualPurchase } from "@/features/workspace/assistant";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Product catalog" };
export default function Page() {
  return (
    <WorkspaceGate>
      <ManualPurchase />
    </WorkspaceGate>
  );
}
