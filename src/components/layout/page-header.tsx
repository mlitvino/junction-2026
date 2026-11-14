import { cn } from "@/components/lib/utils";

export function PageHeader({
  title,
  description,
  action,
  display = false,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  display?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className={display ? "display-title" : "page-title"}>{title}</h1>
        {description && (
          <p className={cn("mt-3 text-muted-foreground", display && "text-large-body")}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
