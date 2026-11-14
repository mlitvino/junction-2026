import { Suspense } from "react";
import type { Metadata } from "next";
import { ProposalView } from "@/features/procurement/proposal-view";
import { LoadingState } from "@/features/procurement/states";

export const metadata: Metadata = { title: "Demo purchase proposal" };
type Props = { params: Promise<{ id: string }> };
async function Content({ params }: Props) {
  return <ProposalView id={(await params).id} />;
}
export default function Page(props: Props) {
  return (
    <Suspense fallback={<LoadingState />}>
      <Content {...props} />
    </Suspense>
  );
}
