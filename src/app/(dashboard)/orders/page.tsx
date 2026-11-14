import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Orders" };
export default function OrdersPage() {
  return (
    <ComingSoon
      title="Orders"
      icon="orders"
      description="Find your simulated orders and review the purchase details behind each one."
    />
  );
}
