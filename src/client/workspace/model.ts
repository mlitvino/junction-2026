import { z } from "zod";
import type { SessionUser } from "@/shared/contracts/me";
import type { Proposal, Order, ApprovalWithProposal } from "@/shared/contracts/purchasing";
import type { ProductDetail, ProductSummary, OffersResponse } from "@/shared/contracts/products";
import type { Recipe } from "@/shared/contracts/recipes";
import type { InventoryItem } from "@/shared/contracts/inventory";
import type { LayersResponse, EffectiveResponse } from "@/shared/contracts/preferences";
import type { Member } from "@/shared/contracts/organization";

// Browser-local presentation records. Canonical purchasing objects always come from its adapter.
const ConversationEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), index: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal("products"),
    id: z.string(),
    query: z.string(),
    replacementId: z.string().optional(),
    proposalId: z.string().optional(),
    closed: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("proposal"), proposalId: z.string() }),
]);
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;
export const ThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(
    z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.string() }),
  ),
  proposals: z.array(z.string()),
  timeline: z.array(ConversationEntrySchema).optional(),
  working: z.boolean(),
  stage: z.string(),
  query: z.string(),
  source: z.enum(["Assistant", "Manual", "Restocking", "Recipes"]),
  diff: z.string().optional(),
  error: z.string().optional(),
  recipeChoice: z.boolean().optional(),
  safetyBlocked: z.boolean().optional(),
  requirement: z.enum(["gluten-free", "milk-protein-free"]).optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

// Old browser-local conversations predate the timeline. Recover a stable, read-only history.
export function getConversationTimeline(
  thread: Thread,
  proposals: Proposal[],
): ConversationEntry[] {
  if (thread.timeline) return thread.timeline;
  const entries: { at: string; entry: ConversationEntry }[] = thread.messages.map(
    (message, index) => ({
      at: message.at,
      entry: { kind: "message", index },
    }),
  );
  for (const proposalId of thread.proposals) {
    const proposal = proposals.find((p) => p.id === proposalId);
    entries.push({ at: proposal?.createdAt ?? "9999", entry: { kind: "proposal", proposalId } });
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const result = entries.map(({ entry }) => entry);
  if (thread.query && thread.query !== "restocking" && !thread.safetyBlocked) {
    const firstProposal = result.findIndex((entry) => entry.kind === "proposal");
    result.splice(firstProposal < 0 ? result.length : firstProposal, 0, {
      kind: "products",
      id: `legacy-${thread.id}`,
      query: thread.query,
      proposalId: thread.proposals[0],
    });
  }
  return result;
}
export const PlanSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  productId: z.string(),
  ingredient: z.string(),
  unit: z.string(),
  current: z.number().nonnegative(),
  threshold: z.number().nonnegative(),
  target: z.number().positive(),
  location: z.string(),
  schedule: z.enum(["threshold", "weekly"]),
  paused: z.boolean(),
  inventoryId: z.string().optional(),
});
export type RestockPlan = z.infer<typeof PlanSchema>;
export const RunSchema = z.object({
  id: z.string(),
  planId: z.string(),
  at: z.string(),
  lines: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
      state: z.enum(["ready", "partial", "unknown", "covered"]),
      reason: z.string(),
    }),
  ),
  threadId: z.string().optional(),
});
export type RestockRun = z.infer<typeof RunSchema>;
export const ActivitySchema = z.object({
  id: z.string(),
  at: z.string(),
  text: z.string(),
  resourceId: z.string(),
  detail: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;
export const LocalSchema = z.object({
  version: z.literal(32),
  owner: z.string(),
  threads: z.array(ThreadSchema),
  plans: z.array(PlanSchema),
  runs: z.array(RunSchema),
  activities: z.array(ActivitySchema),
  stale: z.array(z.string()),
  drafts: z.record(z.string(), z.string()),
  orderKeys: z.record(z.string(), z.string()),
});
export type LocalState = z.infer<typeof LocalSchema>;
export type WorkspaceSnapshot = {
  ready: boolean;
  loading: boolean;
  error: string | null;
  notice: string | null;
  user: SessionUser | null;
  proposals: Proposal[];
  orders: Order[];
  approvals: ApprovalWithProposal[];
  products: ProductSummary[];
  productDetails: Record<string, ProductDetail>;
  offers: OffersResponse | null;
  recipes: Recipe[];
  inventory: InventoryItem[];
  layers: LayersResponse | null;
  effective: EffectiveResponse | null;
  members: Member[];
  local: LocalState;
};
export const emptyLocal = (owner: string): LocalState => ({
  version: 32,
  owner,
  threads: [],
  plans: [],
  runs: [],
  activities: [],
  stale: [],
  drafts: {},
  orderKeys: {},
});
export const emptySnapshot = (): WorkspaceSnapshot => ({
  ready: false,
  loading: false,
  error: null,
  notice: null,
  user: null,
  proposals: [],
  orders: [],
  approvals: [],
  products: [],
  productDetails: {},
  offers: null,
  recipes: [],
  inventory: [],
  layers: null,
  effective: null,
  members: [],
  local: emptyLocal(""),
});

// Derived presentation only: use this conversation's latest canonical purchase, never another thread's order.
export function getConversationStatus(
  thread: Thread,
  snapshot: Pick<WorkspaceSnapshot, "proposals" | "orders" | "local">,
  now = Date.now(),
): { status: string; label?: string } {
  if (thread.working) return { status: "PENDING", label: "Preparing" };
  const latestId = thread.proposals.at(-1);
  const proposal = snapshot.proposals.find((record) => record.id === latestId);
  const recorded =
    proposal?.status === "ORDERED" ||
    snapshot.orders.some((order) => order.proposalId === latestId);
  if (thread.safetyBlocked)
    return { status: "BLOCKED", label: recorded ? "New request blocked" : "Needs attention" };
  if (recorded) return { status: "ORDERED" };
  if (proposal) {
    if (
      ["READY", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status) &&
      (snapshot.local.stale.includes(proposal.id) ||
        (proposal.quoteExpiresAt !== null && Date.parse(proposal.quoteExpiresAt) <= now))
    )
      return { status: "READY", label: "Refresh prices" };
    return { status: proposal.status };
  }
  if (thread.error) return { status: "BLOCKED", label: "Needs attention" };
  if (latestId) return { status: "UNKNOWN", label: "Status unavailable" };
  if (thread.recipeChoice) return { status: "PENDING", label: "Choose a recipe" };
  if (thread.query)
    return {
      status: "PENDING",
      label: thread.query === "restocking" ? "Configure restocking" : "Choose products",
    };
  return { status: "DRAFT", label: "No purchase yet" };
}
