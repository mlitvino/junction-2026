import { HealthStatus } from "@/features/health/health-status";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">junction-2026</h1>
      <HealthStatus />
    </main>
  );
}
