"use client";

import Link from "next/link";
import { apiClient } from "@/client/api-client";
import { TrustAgentEyes } from "@/components/ui/trust-agent-eyes";

export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/buyer"
      onNavigate={() => {
        apiClient.workspace.draft("welcome", "");
        onNavigate?.();
      }}
      className="flex min-h-16 items-center gap-3 px-6"
      aria-label="LUUKKU home: Start a new chat"
    >
      <TrustAgentEyes />
      <span>
        <span className="block text-2xl font-black leading-none tracking-[-0.04em]">LUUKKU</span>
        <span className="mt-1 block font-mono text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          by Valio Aimo®
        </span>
      </span>
    </Link>
  );
}
