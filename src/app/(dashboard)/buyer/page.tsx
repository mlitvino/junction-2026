import type { Metadata } from "next";
import { BuyerWorkspace } from "@/features/buyer/buyer-workspace";

export const metadata: Metadata = { title: "Buyer Workspace" };

export default function BuyerPage() {
  return <BuyerWorkspace />;
}
