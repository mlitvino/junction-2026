import { AppShell } from "@/components/layout/app-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // No session is fabricated. Supply the viewer from api-client after auth contracts are agreed.
  return <AppShell>{children}</AppShell>;
}
