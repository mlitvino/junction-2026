import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ProvisionalSnapshot } from "@/client/provisional/types";

export function EmptyState({
  title,
  description,
  href,
  action,
  page = false,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
  page?: boolean;
}) {
  const Heading = page ? "h1" : "h2";
  return (
    <div className="py-12 text-center">
      <Icon name="workspace" className="mx-auto mb-4 text-muted-foreground" />
      <Heading className={page ? "page-title" : "section-title"}>{title}</Heading>
      <p className="mx-auto mt-3 max-w-lg text-muted-foreground">{description}</p>
      {href && (
        <Link className={buttonVariants({ variant: "outline", className: "mt-6" })} href={href}>
          {action ?? "Back to workspace"}
        </Link>
      )}
    </div>
  );
}
export function ErrorState({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-destructive/30 p-4 text-sm">
      <Icon name="info" className="shrink-0 text-destructive" />
      <p className="min-w-0 break-words">{message}</p>
    </div>
  );
}
export function LoadingState() {
  return (
    <p role="status" className="py-12 text-center text-muted-foreground">
      Loading your local workspace…
    </p>
  );
}

export function IntegrationState({ snapshot }: { snapshot: ProvisionalSnapshot }) {
  if (!snapshot.ready) return <LoadingState />;
  return (
    <EmptyState
      page
      title="Procurement integration unavailable"
      description="The procurement backend is not connected yet. To explore the local demonstration, start the app with NEXT_PUBLIC_USE_MOCKS=true. No request has been submitted."
    />
  );
}

export function DemoStorageNotice({ notice }: { notice: string | null }) {
  return notice ? (
    <p role="status" className="mb-6 rounded-md bg-warning-surface p-3 text-sm text-warning">
      {notice}
    </p>
  ) : null;
}
