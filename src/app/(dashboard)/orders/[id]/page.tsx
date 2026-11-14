import { Suspense } from "react";
import type { Metadata } from "next";
import { OrderDetail } from "@/features/workspace/purchasing-pages";
import { WorkspaceGate, Loading } from "@/features/workspace/ui";
export const metadata: Metadata = { title: "Order details" };
type Props = { params: Promise<{ id: string }> };
async function Content({ params }: Props) {
  const { id } = await params;
  return (
    <WorkspaceGate>
      <OrderDetail id={id} />
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
