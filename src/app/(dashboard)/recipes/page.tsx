import type { Metadata } from "next";
import { Recipes } from "@/features/workspace/recipes";
import { WorkspaceGate } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Recipes" };
export default function Page() {
  return (
    <WorkspaceGate>
      <Recipes />
    </WorkspaceGate>
  );
}
