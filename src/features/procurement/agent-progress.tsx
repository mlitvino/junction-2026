import type { ProvisionalConversation } from "@/client/provisional/types";
import { Icon } from "@/components/ui/icon";

export function AgentProgress({ conversation }: { conversation: ProvisionalConversation }) {
  const steps = conversation.events.filter((event) => event.event === "status");
  const latest = steps[steps.length - 1];
  return (
    <section aria-label="Simulated agent progress" className="rounded-lg bg-muted p-4">
      <p role="status" className="flex items-start gap-2 text-sm">
        <Icon name="agents" className="shrink-0" />
        <span>
          <span className="font-medium">
            {conversation.status === "RUNNING" ? "Simulated agent" : "Demo run"}
          </span>{" "}
          ·{" "}
          {conversation.status === "RUNNING"
            ? (latest?.data.message ?? "Starting…")
            : conversation.status === "DONE"
              ? "Finished"
              : "Stopped"}
        </span>
      </p>
      <details className="mt-3 text-caption text-muted-foreground">
        <summary className="min-h-8 py-1">View simulated steps</summary>
        <ol className="mt-2 space-y-2">
          {steps.map((event) => (
            <li key={event.sequence}>{event.data.message}</li>
          ))}
        </ol>
        <p className="mt-3">Scripted fixture events, not an LLM or supplier connection.</p>
      </details>
    </section>
  );
}
