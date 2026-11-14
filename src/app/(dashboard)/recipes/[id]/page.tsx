import { Suspense } from "react";
import type { Metadata } from "next";
import { RecipePage } from "@/features/workspace/recipes";
import { WorkspaceGate, Loading } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Recipe" };
type Props = { params: Promise<{ id: string }> };
async function Content({ params }: Props) {
  const { id } = await params;
  return (
    <WorkspaceGate>
      <RecipePage id={id} />
    </WorkspaceGate>
  );
}
export default function Page(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Content {...props} />
    </Suspense>
  );
}
