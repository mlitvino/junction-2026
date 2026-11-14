import { Suspense } from "react";
import type { Metadata } from "next";
import { ApprovalDetail } from "@/features/approvals/approval-detail";
import { LoadingState } from "@/features/procurement/states";

export const metadata: Metadata = { title: "Demo approval" };
type Props = { params: Promise<{ id: string }> };
async function Content({ params }: Props) {
  return <ApprovalDetail id={(await params).id} />;
}
export default function Page(props: Props) {
  return (
    <Suspense fallback={<LoadingState />}>
      <Content {...props} />
    </Suspense>
  );
}
