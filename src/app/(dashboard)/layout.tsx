import { DemoAppShell } from "@/components/layout/demo-app-shell";
import { AuthPanel } from "@/features/auth/auth-panel";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DemoAppShell>{children}</DemoAppShell>
      {/* Pages are public; this opens when a guest does something that needs an account. */}
      <AuthPanel />
    </>
  );
}
