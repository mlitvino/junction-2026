import { DemoAppShell } from "@/components/layout/demo-app-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DemoAppShell>{children}</DemoAppShell>;
}
