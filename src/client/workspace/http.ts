import { z } from "zod";
import { MeResponseSchema } from "@/shared/contracts/me";
import { HealthResponseSchema } from "@/shared/contracts/health";
import { AgentRunRequestSchema, AgentRunResponseSchema } from "@/shared/contracts/agent";
import {
  CreateProposalRequestSchema,
  ProposalSchema,
  ProposalListSchema,
  ApprovalListSchema,
  PendingApprovalCountSchema,
  OrderSchema,
  OrderListSchema,
  DecideApprovalRequestSchema,
  CreateProposalFromPromptRequestSchema,
  ProposalFromPromptResponseSchema,
  ReviseProposalRequestSchema,
  ReviseProposalResponseSchema,
  OrderReceiptSchema,
  ProposalVerificationSchema,
  AuditListSchema,
  AuditQuerySchema,
} from "@/shared/contracts/purchasing";
import {
  ProductSearchResponseSchema,
  ProductDetailSchema,
  OffersResponseSchema,
  RankProductsRequestSchema,
  RankProductsResponseSchema,
} from "@/shared/contracts/products";
import { PolicyDecisionSchema, PolicyEvaluateRequestSchema } from "@/shared/contracts/policy";
import {
  RecipeSchema,
  RecipeListResponseSchema,
  CreateRecipeRequestSchema,
  CreateOrderFromRecipeRequestSchema,
  CreateOrderFromRecipeResponseSchema,
} from "@/shared/contracts/recipes";
import {
  InventoryListResponseSchema,
  InventoryItemSchema,
  UpsertInventoryItemRequestSchema,
  AdjustInventoryItemRequestSchema,
} from "@/shared/contracts/inventory";
import {
  LayersResponseSchema,
  EffectiveResponseSchema,
  LayerSchema,
  UpdateLayerRequestSchema,
  type LayerScope,
} from "@/shared/contracts/preferences";
import {
  MembersResponseSchema,
  MemberSchema,
  CreateMemberRequestSchema,
  UpdateRolesRequestSchema,
} from "@/shared/contracts/organization";
import {
  StockoutAlertsResponseSchema,
  ProductSubstitutionResponseSchema,
  ProductSubstitutionRequestSchema,
} from "@/shared/contracts/intelligence";
import { ExtractResponseSchema } from "@/shared/contracts/extract";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "REQUEST_FAILED",
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function createHttpApi(transport: typeof fetch = (...args) => fetch(...args)) {
  async function request<S extends z.ZodType>(
    path: string,
    schema: S,
    method = "GET",
    body?: unknown,
  ): Promise<z.output<S>> {
    let response: Response;
    try {
      response = await transport(`/api${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(
        "Could not reach the service. Your draft is still available; try again.",
        503,
        "NETWORK_ERROR",
      );
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = z
        .object({ error: z.unknown().optional(), code: z.string().optional() })
        .safeParse(value);
      const code = parsed.success ? parsed.data.code : undefined;
      const error =
        parsed.success && typeof parsed.data.error === "string"
          ? parsed.data.error
          : response.status === 401
            ? "Your session has expired. Please sign in again."
            : response.status === 403
              ? "Your account does not have permission for this action."
              : "The service could not complete this request.";
      // Something needed an account: open the sign-in panel (src/client/auth-panel.ts). Not for the
      // passive /me check on page load: guests may browse without being asked to sign in.
      if (response.status === 401 && path !== "/me" && typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent("luukku:auth-required", { detail: "login" }));
      throw new ApiError(error, response.status, code);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new ApiError(
        "The service returned an unexpected response. No local purchase will be created.",
        502,
        "CONTRACT_MISMATCH",
      );
    return parsed.data;
  }
  return {
    getMe: () => request("/me", MeResponseSchema),
    getHealth: () => request("/health", HealthResponseSchema),
    searchProducts: (
      q: string,
      offset = 0,
      filters?: {
        dietary?: string;
        excludeAllergens?: string;
        excludeMayContain?: boolean;
        sort?: "name" | "co2" | "reliability";
      },
    ) => {
      const params = new URLSearchParams({ q, offset: String(offset), limit: "20" });
      if (filters?.dietary) params.set("dietary", filters.dietary);
      if (filters?.excludeAllergens) params.set("excludeAllergens", filters.excludeAllergens);
      if (filters?.excludeMayContain) params.set("excludeMayContain", "true");
      if (filters?.sort) params.set("sort", filters.sort);
      return request(`/products?${params}`, ProductSearchResponseSchema);
    },
    rankProducts: (body: z.input<typeof RankProductsRequestSchema>) =>
      request(
        "/products/rank",
        RankProductsResponseSchema,
        "POST",
        RankProductsRequestSchema.parse(body),
      ),
    getProduct: (id: string) => request(`/products/${encodeURIComponent(id)}`, ProductDetailSchema),
    getOffers: (productIds: string[], date?: string) =>
      request("/offers", OffersResponseSchema, "POST", { productIds, date }),
    evaluatePolicy: (body: z.input<typeof PolicyEvaluateRequestSchema>) =>
      request(
        "/policy/evaluate",
        PolicyDecisionSchema,
        "POST",
        PolicyEvaluateRequestSchema.parse(body),
      ),
    listProposals: () => request("/proposals", ProposalListSchema),
    getProposal: (id: string) => request(`/proposals/${encodeURIComponent(id)}`, ProposalSchema),
    createProposal: (body: z.input<typeof CreateProposalRequestSchema>) =>
      request("/proposals", ProposalSchema, "POST", CreateProposalRequestSchema.parse(body)),
    cancelProposal: (id: string) =>
      request(`/proposals/${encodeURIComponent(id)}/cancel`, ProposalSchema, "POST"),
    requestApproval: (id: string) =>
      request(`/proposals/${encodeURIComponent(id)}/approval`, ProposalSchema, "POST"),
    listApprovals: () => request("/approvals", ApprovalListSchema),
    getPendingApprovalCount: () => request("/approvals/pending-count", PendingApprovalCountSchema),
    decideApproval: (id: string, body: z.input<typeof DecideApprovalRequestSchema>) =>
      request(
        `/approvals/${encodeURIComponent(id)}/decision`,
        ProposalSchema,
        "POST",
        DecideApprovalRequestSchema.parse(body),
      ),
    placeOrder: (id: string, idempotencyKey: string) =>
      request(`/proposals/${encodeURIComponent(id)}/order`, OrderSchema, "POST", {
        idempotencyKey,
      }),
    listOrders: () => request("/orders", OrderListSchema),
    getOrder: (id: string) => request(`/orders/${encodeURIComponent(id)}`, OrderSchema),
    listRecipes: (q = "") =>
      request(`/recipes?${new URLSearchParams({ q })}`, RecipeListResponseSchema),
    getRecipe: (id: string) => request(`/recipes/${encodeURIComponent(id)}`, RecipeSchema),
    createRecipe: (body: z.input<typeof CreateRecipeRequestSchema>) =>
      request("/recipes", RecipeSchema, "POST", CreateRecipeRequestSchema.parse(body)),
    getInventory: () => request("/inventory", InventoryListResponseSchema),
    saveInventory: (body: z.input<typeof UpsertInventoryItemRequestSchema>) =>
      request(
        "/inventory/items",
        InventoryItemSchema,
        "POST",
        UpsertInventoryItemRequestSchema.parse(body),
      ),
    adjustInventory: (id: string, body: z.input<typeof AdjustInventoryItemRequestSchema>) =>
      request(
        `/inventory/items/${encodeURIComponent(id)}`,
        InventoryItemSchema,
        "PATCH",
        AdjustInventoryItemRequestSchema.parse(body),
      ),
    getLayers: () => request("/preferences/layers", LayersResponseSchema),
    getEffective: () => request("/preferences/effective", EffectiveResponseSchema),
    saveLayer: (scope: LayerScope, body: z.input<typeof UpdateLayerRequestSchema>) =>
      request(
        `/preferences/layers/${scope}`,
        LayerSchema,
        "PUT",
        UpdateLayerRequestSchema.parse(body),
      ),
    getMembers: () => request("/organization/members", MembersResponseSchema),
    createMember: (body: z.input<typeof CreateMemberRequestSchema>) =>
      request("/organization/members", MemberSchema, "POST", CreateMemberRequestSchema.parse(body)),
    updateRoles: (id: string, body: z.input<typeof UpdateRolesRequestSchema>) =>
      request(
        `/organization/members/${encodeURIComponent(id)}/roles`,
        MemberSchema,
        "PUT",
        UpdateRolesRequestSchema.parse(body),
      ),
    getAlerts: (date: string) =>
      request(
        `/intelligence/stockout-alerts?deliveryDate=${encodeURIComponent(date)}`,
        StockoutAlertsResponseSchema,
      ),
    substitutions: (body: z.input<typeof ProductSubstitutionRequestSchema>) => {
      const parsed = ProductSubstitutionRequestSchema.parse(body);
      return request(
        `/products/${encodeURIComponent(parsed.productId)}/substitutes`,
        ProductSubstitutionResponseSchema,
        "POST",
        {
          requestedQuantity: parsed.requestedQuantity,
          ...(parsed.deliveryDate ? { deliveryDate: parsed.deliveryDate } : {}),
        },
      );
    },
    extract: (prompt: string) => request("/extract", ExtractResponseSchema, "POST", { prompt }),
    runAgent: (body: z.input<typeof AgentRunRequestSchema>) =>
      request("/agent/run", AgentRunResponseSchema, "POST", AgentRunRequestSchema.parse(body)),
    createProposalFromPrompt: (body: z.input<typeof CreateProposalFromPromptRequestSchema>) =>
      request(
        "/proposals/from-prompt",
        ProposalFromPromptResponseSchema,
        "POST",
        CreateProposalFromPromptRequestSchema.parse(body),
      ),
    createProposalFromRecipe: (body: z.input<typeof CreateOrderFromRecipeRequestSchema>) =>
      request(
        "/proposals/from-recipe",
        CreateOrderFromRecipeResponseSchema,
        "POST",
        CreateOrderFromRecipeRequestSchema.parse(body),
      ),
    reviseProposal: (id: string, body: z.input<typeof ReviseProposalRequestSchema>) =>
      request(
        `/proposals/${encodeURIComponent(id)}/revise`,
        ReviseProposalResponseSchema,
        "POST",
        ReviseProposalRequestSchema.parse(body),
      ),
    getProposalAudit: (id: string) =>
      request(`/proposals/${encodeURIComponent(id)}/audit`, AuditListSchema),
    verifyProposal: (id: string) =>
      request(`/proposals/${encodeURIComponent(id)}/verify`, ProposalVerificationSchema),
    getOrderReceipt: (id: string) =>
      request(`/orders/${encodeURIComponent(id)}/receipt`, OrderReceiptSchema),
    listAudit: (query?: z.input<typeof AuditQuerySchema>) => {
      const params = new URLSearchParams();
      const parsed = query ? AuditQuerySchema.parse(query) : undefined;
      if (parsed?.resourceType) params.set("resourceType", parsed.resourceType);
      if (parsed?.resourceId) params.set("resourceId", parsed.resourceId);
      if (parsed?.limit) params.set("limit", String(parsed.limit));
      const qs = params.toString();
      return request(`/audit${qs ? `?${qs}` : ""}`, AuditListSchema);
    },
  };
}
export type WorkspaceApi = ReturnType<typeof createHttpApi>;
