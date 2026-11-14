"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const examples = [
  {
    title: "Stock up on the essentials",
    request:
      "I need 100 litres of lactose-free milk by Monday. Prefer Finnish products, with a total budget of €200.",
  },
  {
    title: "Plan a plant-based breakfast",
    request: "Help me find oat drinks and plant-based yogurts for 40 breakfast guests next week.",
  },
  {
    title: "Find ingredients for lunch",
    request:
      "I’m planning lunch for 60 people. Help me find potatoes, carrots and cooking cream for Friday.",
  },
];

export function RequestComposer() {
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="mt-8">
      <form onSubmit={(event) => event.preventDefault()} aria-label="Purchase request draft">
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
            placeholder="For example, 100 litres of lactose-free milk for Monday…"
            aria-describedby="composer-help composer-availability"
            className="block min-h-32 w-full resize-y bg-transparent text-large-body outline-none focus-visible:outline-none"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p id="composer-help" className="text-caption text-muted-foreground">
              A draft for now. Nothing will be sent.
            </p>
            <Button disabled aria-describedby="composer-availability">
              <Icon name="arrow" className="size-4" />
              Coming next milestone
            </Button>
          </div>
        </div>
        <p id="composer-availability" className="mt-3 text-caption text-muted-foreground">
          Request execution is coming in the next milestone.
        </p>
      </form>
      <div className="mt-6">
        <p className="mb-3 text-label text-muted-foreground">Or start with an idea</p>
        <div className="grid gap-3 md:grid-cols-3">
          {examples.map((example) => (
            <button
              type="button"
              key={example.title}
              onClick={() => {
                setDraft(example.request);
                setAnnouncement(`${example.title} example added to your draft.`);
                textarea.current?.focus();
              }}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-card px-4 py-3 text-left text-label transition-colors hover:border-input hover:bg-accent hover:text-accent-foreground"
            >
              <span>{example.title}</span>
              <Icon name="chevron" className="size-4 shrink-0" />
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
