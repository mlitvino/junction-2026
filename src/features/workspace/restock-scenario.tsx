"use client";

import { useWorkspace } from "@/client/use-workspace";
import { RESTOCK_SCENARIO_PROMPT } from "@/client/workspace/restock-scenario";
import { Button } from "@/components/ui/button";
import { useAction } from "@/features/procurement/use-action";
import { ErrorMessage, Panel, store } from "./ui";

export function RestockScenarioSetup({ threadId }: { threadId?: string }) {
  const s = useWorkspace();
  const action = useAction();
  if (store.mock || !s.user?.roles.includes("buyer")) return null;
  const loaded =
    s.local.plans.filter((plan) => plan.id.startsWith("starter-restock-")).length === 4;
  if (loaded) return null;
  return (
    <Panel>
      <h2 className="section-title">Ready-to-try kitchen restock</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Four real Valio Aimo products: milk, cooking cream, butter and grated cheese. Sets demo
        stock below the trigger for milk and cream, with enough butter and cheese. Quantities use
        each product&apos;s sales unit.
      </p>
      <p className="mt-2 text-caption text-muted-foreground">
        Existing stock levels for these four products will be updated. Prices, availability and
        purchasing rules are checked when preparing the proposal.
      </p>
      <ErrorMessage error={action.error} />
      <Button
        className="mt-4"
        variant="outline"
        disabled={
          action.busy || !!s.local.threads.find((thread) => thread.id === threadId)?.working
        }
        onClick={() =>
          void action.run(async () => {
            await store.setupRestockScenario();
            if (threadId) await store.sendMessage(threadId, RESTOCK_SCENARIO_PROMPT);
          })
        }
      >
        {action.busy ? "Loading catalog products…" : "Load 4-product restock scenario"}
      </Button>
    </Panel>
  );
}
