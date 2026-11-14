"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/client/api-client";
import { simulatorAvailable, useProcurement } from "@/client/use-procurement";
import { useViewer } from "@/client/use-viewer";
import { viewerHasRole } from "@/client/viewer";
import type { ProvisionalScenario } from "@/client/provisional/types";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ErrorState } from "@/features/procurement/states";
import { useAction } from "@/features/procurement/use-action";

export function RequestComposer() {
  const snapshot = useProcurement();
  const [draft, setDraft] = useState("");
  const [scenarioId, setScenarioId] = useState<ProvisionalScenario["id"]>("happy-path-auto");
  const [announcement, setAnnouncement] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<{ payload: string; key: string } | null>(null);
  const action = useAction();
  const router = useRouter();
  const running = snapshot.state.conversations.some((c) => c.status === "RUNNING");
  const viewer = useViewer();
  const demoIdentity = viewer.status === "ready" && viewer.viewer.demo;
  const allowed = simulatorAvailable(snapshot) && viewerHasRole(viewer, "BUYER");
  return (
    <div className="mt-8 space-y-4">
      <ErrorState message={action.error} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const payload = `${scenarioId}:${draft.trim()}`;
            if (requestRef.current?.payload !== payload)
              requestRef.current = { payload, key: crypto.randomUUID() };
            const previous = apiClient.procurement.getSnapshot().state.activeConversationId;
            const operation = apiClient.procurement.startConversation({
              scenarioId,
              message: draft,
              clientRequestId: requestRef.current.key,
            });
            const active = apiClient.procurement.getSnapshot().state.activeConversationId;
            if (active && active !== previous) router.push(`/buyer/conversations/${active}`);
            await operation;
          });
        }}
        aria-label="Purchase request"
      >
        <label htmlFor="purchase-request" className="mb-3 block text-label font-medium">
          Your request
        </label>
        <div className="rounded-lg border border-input bg-card p-4 focus-within:border-ring md:p-6">
          <textarea
            ref={textarea}
            id="purchase-request"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Choose a demo scenario below to try a purchasing request…"
            aria-describedby="composer-help"
            className="block min-h-32 w-full resize-y bg-transparent text-large-body outline-none focus-visible:outline-none"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p id="composer-help" className="text-caption text-muted-foreground">
              Scripted demo. No supplier requests or real orders.
            </p>
            <Button type="submit" disabled={!allowed || !draft.trim() || action.busy || running}>
              <Icon name="arrow" className="size-4" />
              {running || action.busy ? "Demo running…" : "Send demo request"}
            </Button>
          </div>
        </div>
      </form>
      {!allowed && snapshot.ready && (
        <p className="text-sm text-muted-foreground">
          {!simulatorAvailable(snapshot)
            ? "Procurement integration is unavailable. Enable the local mock demo to continue."
            : demoIdentity
              ? "Switch to Demo Buyer in the account menu to start a request."
              : "Your account doesn't have the buyer role. An approver in your organization can add it."}
        </p>
      )}
      <details className="text-sm" open={!draft || undefined}>
        <summary className="min-h-11 py-3 text-muted-foreground">
          Demo scenarios · choose a prepared request
        </summary>
        <p className="mb-4 text-caption text-muted-foreground">
          These three scripts demonstrate fixed outcomes. Arbitrary edited requests are not
          interpreted by an LLM.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {snapshot.scenarios.map((scenario) => (
            <button
              type="button"
              key={scenario.id}
              disabled={running}
              onClick={() => {
                setScenarioId(scenario.id);
                setDraft(scenario.prompt);
                setAnnouncement(`${scenario.label} scenario selected.`);
                textarea.current?.focus();
              }}
              className="min-h-11 rounded-md border bg-card p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              <span className="block text-label font-medium">{scenario.label}</span>
              <span className="mt-2 block text-caption text-muted-foreground">
                {scenario.description}
              </span>
            </button>
          ))}
        </div>
      </details>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
