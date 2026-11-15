import { z } from "zod";
import type { SessionUser } from "@/shared/contracts/me";
import type { Proposal, Order, ApprovalWithProposal } from "@/shared/contracts/purchasing";
import type { ProductDetail, ProductSummary, OffersResponse } from "@/shared/contracts/products";
import type { Recipe } from "@/shared/contracts/recipes";
import { RecipeIngredientReconciliationSchema } from "@/shared/contracts/recipes";
import type { InventoryItem } from "@/shared/contracts/inventory";
import type { LayersResponse, EffectiveResponse } from "@/shared/contracts/preferences";
import type { Member } from "@/shared/contracts/organization";

// Browser-local presentation records. Canonical purchasing objects always come from its adapter.
export const ThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(
    z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.string() }),
  ),
  proposals: z.array(z.string()),
  working: z.boolean(),
  stage: z.string(),
  query: z.string(),
  source: z.enum(["Assistant", "Manual", "Restocking", "Recipes"]),
  diff: z.string().optional(),
  error: z.string().optional(),
  recipeChoice: z.boolean().optional(),
  recipeReconciliation: z
    .object({
      recipeId: z.string(),
      recipeName: z.string(),
      requestedServings: z.number(),
      scaleFactor: z.number(),
      items: z.array(RecipeIngredientReconciliationSchema),
    })
    .optional(),
  safetyBlocked: z.boolean().optional(),
  requirement: z.enum(["gluten-free", "milk-protein-free"]).optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;
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
