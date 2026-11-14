import type { ProvisionalActivity } from "@/client/provisional/types";
import { timestamp } from "./format";

export function ActivityTimeline({ items }: { items: readonly ProvisionalActivity[] }) {
  return (
    <section aria-labelledby="activity-title">
      <h2 id="activity-title" className="section-title mb-6">
        Activity history
      </h2>
      <ol className="space-y-6 border-l pl-6">
        {items.map((item) => (
          <li key={item.id}>
            <p className="text-sm">{item.explanation}</p>
            <p className="mt-1 text-caption text-muted-foreground">
              <span>
                {item.actorId === "demo-approver"
                  ? "Demo Approver"
                  : item.actorId === "demo-buyer"
                    ? "Demo Buyer"
                    : item.actorId === "demo-simulator"
                      ? "Local demo simulator"
                      : item.actorId}
              </span>{" "}
              ·{" "}
              <time
                dateTime={item.timestamp}
                title={`${item.timestamp} · displayed in Europe/Helsinki`}
              >
                {timestamp(item.timestamp)}
              </time>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
