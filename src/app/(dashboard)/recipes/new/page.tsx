import type { Metadata } from "next";
import { RecipePage } from "@/features/workspace/recipes";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Create recipe" };
export default function Page() {
  return (
    <WorkspaceGate>
      <RecipePage create />
    </WorkspaceGate>
  );
}
