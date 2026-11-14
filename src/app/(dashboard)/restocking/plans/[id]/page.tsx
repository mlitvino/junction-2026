import { Suspense } from "react";
import type { Metadata } from "next";
import { RestockEditor } from "@/features/workspace/restocking";
import { WorkspaceGate, Loading } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Restock plan" };
type Props = { params: Promise<{ id: string }> };
async function Content({ params }: Props) {
  const { id } = await params;
  return (
    <WorkspaceGate>
      <RestockEditor id={id} />
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
