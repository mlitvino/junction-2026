import type { Metadata } from "next";
import { BuyerWelcome } from "@/features/buyer/buyer-welcome";

export const metadata: Metadata = { title: "Buyer Workspace" };

export default function BuyerPage() {
  return <BuyerWelcome />;
}
