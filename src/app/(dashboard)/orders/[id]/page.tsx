import { Suspense } from "react";
import type { Metadata } from "next";
import { OrderDetail } from "@/features/orders/order-detail";
import { LoadingState } from "@/features/procurement/states";

export const metadata: Metadata = { title: "Simulated order" };
type Props = { params: Promise<{ id: string }> };
async function Content({ params }: Props) {
  return <OrderDetail id={(await params).id} />;
}
export default function Page(props: Props) {
  return (
    <Suspense fallback={<LoadingState />}>
      <Content {...props} />
    </Suspense>
  );
}
