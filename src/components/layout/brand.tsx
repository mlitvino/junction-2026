import Link from "next/link";
import { Icon } from "@/components/ui/icon";

export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/buyer"
      onClick={onNavigate}
      className="flex min-h-16 items-center gap-3 px-6"
      aria-label="Aimo TrustBridge home"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Icon name="leaf" />
      </span>
      <span>
        <span className="block text-sm font-semibold tracking-tight">Aimo TrustBridge</span>
        <span className="block text-caption text-muted-foreground">
          A little help for your kitchen
        </span>
      </span>
    </Link>
  );
}
