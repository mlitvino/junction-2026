import type { Metadata } from "next";
import { ToReview } from "@/features/workspace/purchasing-pages";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "To review" };
export default function Page() {
  return (
    <WorkspaceGate>
      <ToReview />
    </WorkspaceGate>
  );
}
