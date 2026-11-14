import { PageHeader } from "@/components/layout/page-header";
import { Icon, type IconName } from "@/components/ui/icon";
import { RequestComposer } from "./request-composer";

const capabilities: { icon: IconName; title: string; description: string }[] = [
  {
    icon: "search",
    title: "Find the right products",
    description: "Search for what your kitchen needs, with your requirements in mind.",
  },
  {
    icon: "orders",
    title: "Compare your options",
    description: "Review prices and availability, with uncertainty clearly explained.",
  },
  {
    icon: "shield",
    title: "Stay in control",
    description: "Follow purchasing rules and ask for human approval when needed.",
  },
];

export function BuyerWelcome() {
  return (
    <div className="mx-auto flex w-full max-w-conversation flex-1 flex-col justify-center py-8 md:py-12">
      <div className="mb-8 flex size-12 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon name="leaf" className="size-6" />
      </div>
      <PageHeader
        display
        title="What can I help you order?"
        description="Tell us what your kitchen needs. Start with a product, a quantity, or a menu you have in mind."
      />
      <RequestComposer />
      <section aria-labelledby="capabilities-title" className="mt-12 border-t pt-8">
        <h2 id="capabilities-title" className="mb-6 text-label font-medium text-muted-foreground">
          Explore the purchasing experience with synthetic demo data
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {capabilities.map((capability) => (
            <div key={capability.title}>
              <Icon name={capability.icon} className="mb-3 text-muted-foreground" />
              <h3 className="text-sm font-medium">{capability.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {capability.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
