import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "./page-header";

export function ComingSoon({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: IconName;
}) {
  return (
    <div className="mx-auto w-full max-w-data">
      <PageHeader title={title} />
      <section
        className="mx-auto flex max-w-lg flex-col items-center py-16 text-center md:py-24"
        aria-labelledby="coming-soon-title"
      >
        <span className="mb-6 flex size-14 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon name={icon} className="size-6" />
        </span>
        <p className="mb-3 text-caption font-medium text-muted-foreground">Coming soon</p>
        <h2 id="coming-soon-title" className="section-title">
          A place for {title.toLowerCase()}
        </h2>
        <p className="mt-4 text-large-body text-muted-foreground">{description}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          This section is a placeholder in the frontend preview.
        </p>
        <Link href="/buyer" className={buttonVariants({ variant: "outline", className: "mt-8" })}>
          Back to workspace
        </Link>
      </section>
    </div>
  );
}
