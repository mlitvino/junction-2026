import { Suspense } from "react";
import type { Metadata } from "next";
import { BuyerConversation } from "@/features/buyer/buyer-workspace";
import { LoadingState } from "@/features/procurement/states";

export const metadata: Metadata = { title: "Demo conversation" };
type Props = { params: Promise<{ id: string }> };
async function Content({ params }: Props) {
  return <BuyerConversation id={(await params).id} />;
}
export default function Page(props: Props) {
  return (
    <Suspense fallback={<LoadingState />}>
      <Content {...props} />
    </Suspense>
  );
}
