import { z } from "zod";
import {
  ProposalSchema,
  OrderSchema,
  type Proposal,
  type CreateProposalRequest,
  type Approval,
} from "@/shared/contracts/purchasing";
import { ProductDetailSchema } from "@/shared/contracts/products";
import { RecipeSchema } from "@/shared/contracts/recipes";
import { InventoryItemSchema } from "@/shared/contracts/inventory";
import { LayersResponseSchema, type Preferences } from "@/shared/contracts/preferences";
import { SessionUserSchema, type Role } from "@/shared/contracts/me";
import { MemberSchema } from "@/shared/contracts/organization";
import { ApiError, type WorkspaceApi } from "./http";

const now = () => new Date().toISOString();
export const defaultPreferences: Preferences = {
  maxCo2PerKg: null,
  minDeliveryReliability: null,
  preferredOriginCountries: ["fi"],
  excludedAllergens: [],
  preferredVendors: [],
  blockedVendors: [],
  preferredBrands: [],
  maxOrderValue: null,
  autoApproveBelow: null,
  autonomy: "suggest_only",
  allowSubstitutes: false,
  language: "en",
};
const product = (id: string, name: string, salesUnit: string, weight: number | null) =>
  ProductDetailSchema.parse({
    id,
    name,
    salesUnit,
    vendorName: "Kitchen supplier",
    brand: "Nordic Kitchen",
    category: "FOOD",
    gtin: null,
    temperatureCondition: 2,
    countryOfOrigin: "fi",
    co2PerKg: null,
    deliveryReliability: 0.98,
    hasImage: false,
    names: { en: name, fi: null, sv: null },
    baseUnit: salesUnit,
    allowedLotSize: 1,
    units: [{ unitId: salesUnit, gtin: null, sizeInBaseUnits: 1 }],
    allergens: [],
    storageTempC: null,
    netWeightKg: weight,
    co2PerBaseUnit: null,
    vatCode: null,
    substitutes: [],
  });
export const fixtureProducts = [
  product("milk", "Nordic lactose-free milk, 1 L", "L", null),
  product("cheese", "Lighter pizza cheese", "KG", 1),
  product("pasta", "Durum wheat macaroni", "KG", 1),
  product("beef", "Minced beef, 10% fat", "KG", 1),
  product("onion", "Diced onions", "KG", 1),
  product("butter", "Lactose-free kitchen butter", "KG", 1),
  product("salt", "Sea salt", "KG", 1),
  product("cream", "Lactose-free cooking cream", "L", null),
  product("oat", "Plant-based whipping alternative", "L", null),
];
const unitPrices: Record<string, number> = {
  milk: 1.55,
  cheese: 9.8,
  pasta: 2.4,
  beef: 7.2,
  onion: 1.5,
  butter: 6.2,
  salt: 0.8,
  cream: 3.4,
  oat: 3.6,
};
fixtureProducts[1] = ProductDetailSchema.parse({
  ...fixtureProducts[1],
  salesUnit: "KI",
  baseUnit: "KG",
  units: [
    { unitId: "KG", gtin: null, sizeInBaseUnits: 1 },
    { unitId: "KI", gtin: null, sizeInBaseUnits: 4 },
  ],
});
fixtureProducts.push(
  product("butter-service", "Lactose-free kitchen butter — service pack", "KG", 1),
);
unitPrices["butter-service"] = 6.5;
fixtureProducts.push(
  product("milk-alternative", "Nordic lactose-free milk — kitchen alternative", "L", null),
);
unitPrices["milk-alternative"] = 1.65;
unitPrices.cheese = 39.2;
const ingredient = (productName: string, quantity: number) => ({
  productName,
  productType: productName,
  quantity,
  unit: "KG",
});
const recipes = [
  {
    id: "macaroni-classic",
    name: "Macaroni po-flotski — Classic",
    ingredients: [
      ingredient("Durum wheat macaroni", 11),
      ingredient("Minced beef, 10% fat", 12),
      ingredient("Diced onions", 4),
      ingredient("Lactose-free kitchen butter", 1.5),
      ingredient("Sea salt", 0.15),
    ],
  },
  {
    id: "macaroni-tomato",
    name: "Macaroni po-flotski — Tomato variation",
    ingredients: [
      ingredient("Durum wheat macaroni", 11),
      ingredient("Diced onions", 6),
      ingredient("Minced beef, 10% fat", 10),
    ],
  },
  {
    id: "salmon-soup",
    name: "Creamy Nordic salmon soup",
    ingredients: [
      ingredient("Salmon fillet", 12),
      ingredient("Potatoes", 20),
      { productName: "Lactose-free cooking cream", productType: "Cream", quantity: 4, unit: "L" },
    ],
  },
].map((r) =>
  RecipeSchema.parse({
    ...r,
    organizationId: "kitchen",
    source: "customer",
    description: "A kitchen recipe for shared service.",
    baseServings: 100,
    instructions:
      "Prepare ingredients, cook thoroughly and follow your kitchen’s food safety procedures.",
    tags: ["lunch"],
    updatedAt: "2026-11-14T08:00:00.000Z",
  }),
);
const inventory = [
  {
    id: "stock-cheese",
    ingredientName: "Lighter pizza cheese",
    linkedProductId: "cheese",
    quantityInStock: 8,
    minParLevel: 12,
    unit: "KG",
  },
  {
    id: "stock-onion",
    ingredientName: "Diced onions",
    linkedProductId: "onion",
    quantityInStock: 50,
    minParLevel: 10,
    unit: "KG",
  },
  {
    id: "stock-salt",
    ingredientName: "Sea salt",
    linkedProductId: "salt",
    quantityInStock: 10,
    minParLevel: 2,
    unit: "KG",
  },
  {
    id: "stock-butter",
    ingredientName: "Lactose-free kitchen butter",
    linkedProductId: "butter",
    quantityInStock: 1,
    minParLevel: 4,
    unit: "KG",
  },
].map((i) =>
  InventoryItemSchema.parse({
    ...i,
    productType: i.ingredientName,
    organizationId: "kitchen",
    location: "Main kitchen",
    updatedAt: "2026-11-14T08:00:00.000Z",
  }),
);
const initial = () => ({
  user: {
    id: "anna",
    username: "anna.lindholm",
    organization: { id: "kitchen", name: "North Kitchen" },
    roles: ["buyer", "approver"] as Role[],
  },
  proposals: [] as Proposal[],
  orders: [] as z.infer<typeof OrderSchema>[],
  recipes: structuredClone(recipes),
  inventory: structuredClone(inventory),
  layers: LayersResponseSchema.parse({
    base: { scope: "base", values: {}, locked: [], updatedAt: null },
    buyer: { scope: "buyer", values: {}, locked: [], updatedAt: null },
    approver: { scope: "approver", values: {}, locked: [], updatedAt: null },
  }),
  members: [{ userId: "anna", username: "anna.lindholm", roles: ["buyer", "approver"] as Role[] }],
  sequence: 1,
});
const StateSchema = z.object({
  user: SessionUserSchema,
  proposals: z.array(ProposalSchema),
  orders: z.array(OrderSchema),
  recipes: z.array(RecipeSchema),
  inventory: z.array(InventoryItemSchema),
  layers: LayersResponseSchema,
  members: z.array(MemberSchema),
  sequence: z.number(),
});

export function createMockApi(
  storage: () => Storage | null = () => (typeof window === "undefined" ? null : sessionStorage),
) {
  let data = initial(),
    loaded = false;
  let fault: "none" | "price" | "expired" = "none";
  const key = "aimo:v32:records";
  const save = () => {
    try {
      storage()?.setItem(key, JSON.stringify(data));
    } catch {
      /* Session-only behavior remains usable. */
    }
  };
  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = storage()?.getItem(key);
      if (raw) data = StateSchema.parse(JSON.parse(raw));
    } catch {
      data = initial();
    }
  };
  const id = (prefix: string) => `${prefix}-${data.sequence++}`;
  function error(code: string, message: string): never {
    throw new ApiError(message, 409, code);
  }
  function find(proposalId: string) {
    load();
    const p = data.proposals.find((p) => p.id === proposalId);
    if (!p) throw new ApiError("Purchase proposal not found.", 404);
    return p;
  }
  function current(role: "buyer" | "approver") {
    if (!data.user.roles.includes(role))
      throw new ApiError("You do not have permission for this action.", 403);
  }
  function effective(scope: "buyer" | "approver") {
    const values = {
      ...defaultPreferences,
      ...data.layers.base.values,
      ...Object.fromEntries(
        Object.entries(data.layers[scope].values).filter(
          ([key]) => !data.layers.base.locked.includes(key as never),
        ),
      ),
    };
    const sources = Object.fromEntries(
      Object.keys(defaultPreferences).map((key) => [
        key,
        Object.hasOwn(data.layers[scope].values, key) &&
        !data.layers.base.locked.includes(key as never)
          ? scope
          : Object.hasOwn(data.layers.base.values, key)
            ? "organization"
            : "default",
      ]),
    );
    return { values, sources, locked: data.layers.base.locked };
  }
  const api: WorkspaceApi = {
    async getMe() {
      load();
      return structuredClone({ user: data.user });
    },
    async getHealth() {
      return { status: "ok", time: now() };
    },
    async searchProducts(q, offset = 0) {
      const items = fixtureProducts.filter((p) =>
        `${p.name} ${p.id}`.toLowerCase().includes(q.toLowerCase()),
      );
      return { total: items.length, items: items.slice(offset, offset + 20) };
    },
    async getProduct(id) {
      const p = fixtureProducts.find((p) => p.id === id);
      if (!p) throw new ApiError("Product not found.", 404);
      return structuredClone(p);
    },
    async getOffers(ids, date = "2026-11-20") {
      return {
        date,
        source: "mock",
        currency: "EUR",
        unknownProductIds: ids.filter((id) => !unitPrices[id]),
        offers: ids
          .filter((id) => unitPrices[id])
          .map((id) => ({
            productId: id,
            date,
            price: {
              productId: id,
              found: true,
              salesUnit: fixtureProducts.find((p) => p.id === id)!.salesUnit,
              priceExclVat: unitPrices[id]!,
              priceInclVat: null,
              vatRatePct: null,
              listPriceExclVat: null,
              customerPrice: false,
              comparisonPrice: null,
              comparisonUnit: null,
              validFrom: null,
              validTo: null,
              fetchedAt: now(),
            },
            availability: {
              productId: id,
              orderable: true,
              salesBlock: false,
              logisticModel: id === "oat" ? "terminal" : "stock",
              availableQuantity: id === "oat" ? null : id === "butter" ? 2 : 10000,
              availableDate: date,
              orderCutoff: null,
              salesUnit: fixtureProducts.find((p) => p.id === id)!.salesUnit,
              fetchedAt: now(),
            },
          })),
      };
    },
    async evaluatePolicy(body) {
      load();
      const offers = await api.getOffers(
        body.lines.map((l) => l.productId),
        body.date,
      );
      const values = effective("buyer").values;
      const lines = body.lines.map((line) => {
        const offer = offers.offers.find((o) => o.productId === line.productId);
        return {
          ...line,
          salesUnit: offer?.price?.salesUnit ?? null,
          unitPriceExclVat: offer?.price?.priceExclVat ?? null,
          lineTotalExclVat:
            offer?.price?.priceExclVat == null
              ? null
              : Math.round(offer.price.priceExclVat * line.quantity * 100) / 100,
          orderable: offer?.availability?.orderable ?? null,
          availableDate: offer?.availability?.availableDate ?? null,
          availableQuantity: offer?.availability?.availableQuantity ?? null,
        };
      });
      const total = lines.reduce((sum, l) => sum + (l.lineTotalExclVat ?? 0), 0);
      const blocked =
        lines.some((l) => l.unitPriceExclVat === null) ||
        (values.maxOrderValue !== null && total > values.maxOrderValue);
      const allowed =
        !blocked &&
        values.autonomy === "order_within_limits" &&
        values.autoApproveBelow !== null &&
        total < values.autoApproveBelow &&
        lines.every((l) => l.availableQuantity !== null && l.availableQuantity >= l.quantity);
      const outcome = blocked
        ? ("DENY" as const)
        : allowed
          ? ("ALLOW" as const)
          : ("REQUIRE_APPROVAL" as const);
      return {
        outcome,
        lines,
        totalExclVat: total,
        currency: "EUR",
        pricingDate: offers.date,
        source: "mock",
        limits: {
          maxOrderValue: values.maxOrderValue,
          autoApproveBelow: values.autoApproveBelow,
          autonomy: values.autonomy,
        },
        reasons: [
          {
            code: blocked ? "ORDER_VALUE_TOO_HIGH" : allowed ? "WITHIN_LIMITS" : "NO_AUTO_APPROVAL",
            outcome,
            message: blocked
              ? "The purchase exceeds the configured limit or has no price."
              : allowed
                ? "Explicit autonomous limits allow this purchase."
                : "Human approval is required for this purchase.",
          },
        ],
        evaluatedAt: now(),
      };
    },
    async listProposals() {
      load();
      return structuredClone({ items: data.proposals });
    },
    async getProposal(id) {
      return structuredClone(find(id));
    },
    async createProposal(body: CreateProposalRequest) {
      load();
      current("buyer");
      const decision = await api.evaluatePolicy(body);
      const p = ProposalSchema.parse({
        id: id("P"),
        status: decision.outcome === "DENY" ? "BLOCKED" : "READY",
        createdBy: data.user.id,
        createdAt: now(),
        updatedAt: now(),
        lines: decision.lines.map((l) => ({
          ...l,
          name: fixtureProducts.find((p) => p.id === l.productId)?.name ?? l.productId,
          vendorName: "Kitchen supplier",
        })),
        totalExclVat: decision.totalExclVat,
        currency: "EUR",
        pricingDate: decision.pricingDate,
        priceSource: "mock",
        quoteExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        decision: {
          outcome: decision.outcome,
          reasons: decision.reasons,
          limits: decision.limits,
          evaluatedAt: decision.evaluatedAt,
        },
        hash: `local-content-${data.sequence}`,
        note: body.note ?? null,
        approval: null,
        orderId: null,
      });
      data.proposals.unshift(p);
      save();
      return structuredClone(p);
    },
    async cancelProposal(id) {
      const p = find(id);
      current("buyer");
      if (!["READY", "PENDING_APPROVAL", "APPROVED"].includes(p.status))
        error("INVALID_STATE", "This purchase can no longer be cancelled.");
      p.status = "CANCELLED";
      if (p.approval) p.approval.status = "CANCELLED";
      save();
      return structuredClone(p);
    },
    async requestApproval(id) {
      const p = find(id);
      current("buyer");
      if (p.approval) return structuredClone(p);
      if (p.status !== "READY" || p.decision.outcome !== "REQUIRE_APPROVAL")
        error("INVALID_STATE", "This purchase is not awaiting review.");
      const approval: Approval = {
        id: idOf("A"),
        proposalId: p.id,
        proposalHash: p.hash,
        status: "PENDING",
        requestedBy: data.user.id,
        requestedAt: now(),
        decidedBy: null,
        decidedAt: null,
        comment: null,
      };
      p.approval = approval;
      p.status = "PENDING_APPROVAL";
      save();
      return structuredClone(p);
    },
    async listApprovals() {
      load();
      current("approver");
      return structuredClone({
        items: data.proposals
          .filter((p) => p.approval)
          .map((p) => ({ ...p.approval!, proposal: p })),
      });
    },
    async decideApproval(approvalId, body) {
      load();
      current("approver");
      const p = data.proposals.find((p) => p.approval?.id === approvalId);
      if (!p?.approval) throw new ApiError("Review request not found.", 404);
      if (p.hash !== body.proposalHash)
        error("HASH_MISMATCH", "This purchase changed. Open the latest version.");
      if (p.approval.status !== "PENDING")
        error("INVALID_STATE", "This request has already been decided.");
      if (body.decision === "REJECTED" && !body.comment?.trim())
        throw new ApiError("A reason is required.", 422);
      if (Date.parse(p.quoteExpiresAt!) < Date.now())
        error("QUOTE_EXPIRED", "The fixed prices expired. Prepare an updated proposal.");
      p.approval.status = body.decision;
      p.approval.comment = body.comment ?? null;
      p.approval.decidedBy = data.user.id;
      p.approval.decidedAt = now();
      p.status = body.decision;
      save();
      return structuredClone(p);
    },
    async placeOrder(id, key) {
      load();
      current("buyer");
      const replay = data.orders.find((o) => o.idempotencyKey === key);
      if (replay) {
        if (replay.proposalId !== id)
          error("IDEMPOTENCY_CONFLICT", "This request key belongs to another purchase.");
        return structuredClone(replay);
      }
      const p = find(id);
      if (p.orderId) return structuredClone(data.orders.find((o) => o.id === p.orderId)!);
      if (fault !== "none")
        error(
          fault === "price" ? "PRICE_CHANGED" : "QUOTE_EXPIRED",
          "The quote changed. Prepare an updated purchase proposal.",
        );
      if (Date.parse(p.quoteExpiresAt!) < Date.now())
        error("QUOTE_EXPIRED", "The quote expired. Prepare an updated purchase proposal.");
      if (p.status !== "APPROVED" && !(p.status === "READY" && p.decision.outcome === "ALLOW"))
        error("APPROVAL_REQUIRED", "This purchase still needs approval.");
      const order = OrderSchema.parse({
        id: idOf("ORD"),
        proposalId: p.id,
        status: "SIMULATED_CONFIRMED",
        source: "LOCAL_SIMULATOR",
        createdBy: data.user.id,
        createdAt: now(),
        idempotencyKey: key,
        proposalHash: p.hash,
        lines: p.lines,
        totalExclVat: p.totalExclVat,
        currency: p.currency,
      });
      data.orders.unshift(order);
      p.orderId = order.id;
      p.status = "ORDERED";
      save();
      return structuredClone(order);
    },
    async listOrders() {
      load();
      return structuredClone({ items: data.orders });
    },
    async getOrder(id) {
      load();
      const order = data.orders.find((o) => o.id === id);
      if (!order) throw new ApiError("Order not found.", 404);
      return structuredClone(order);
    },
    async listRecipes(q = "") {
      load();
      return {
        recipes: structuredClone(
          data.recipes.filter((r) =>
            `${r.name} ${r.ingredients.map((i) => i.productName).join(" ")}`
              .toLowerCase()
              .includes(q.toLowerCase()),
          ),
        ),
      };
    },
    async getRecipe(id) {
      load();
      const recipe = data.recipes.find((r) => r.id === id);
      if (!recipe) throw new ApiError("Recipe not found.", 404);
      return structuredClone(recipe);
    },
    async createRecipe(body) {
      load();
      const recipe = RecipeSchema.parse({
        ...body,
        id: idOf("recipe"),
        organizationId: "kitchen",
        source: "customer",
        description: body.description ?? null,
        instructions: body.instructions ?? null,
        tags: body.tags ?? [],
        updatedAt: now(),
      });
      data.recipes.unshift(recipe);
      save();
      return recipe;
    },
    async getInventory() {
      load();
      return structuredClone({ organizationId: "kitchen", items: data.inventory });
    },
    async saveInventory(body) {
      load();
      const item = InventoryItemSchema.parse({
        ...body,
        id: body.id ?? idOf("stock"),
        organizationId: "kitchen",
        linkedProductId: body.linkedProductId ?? null,
        minParLevel: body.minParLevel ?? null,
        location: body.location ?? null,
        updatedAt: now(),
      });
      data.inventory = [...data.inventory.filter((i) => i.id !== item.id), item];
      save();
      return item;
    },
    async adjustInventory(id, body) {
      load();
      const item = data.inventory.find((i) => i.id === id);
      if (!item) throw new ApiError("Stock record not found.", 404);
      Object.assign(item, body, {
        quantityInStock:
          body.quantityInStock ?? Math.max(0, item.quantityInStock + (body.quantityDelta ?? 0)),
        updatedAt: now(),
      });
      save();
      return item;
    },
    async getLayers() {
      load();
      current("approver");
      return structuredClone(data.layers);
    },
    async getEffective() {
      load();
      return {
        ...(data.user.roles.includes("buyer") ? { buyer: effective("buyer") } : {}),
        ...(data.user.roles.includes("approver") ? { approver: effective("approver") } : {}),
      } as Awaited<ReturnType<WorkspaceApi["getEffective"]>>;
    },
    async saveLayer(scope, body) {
      load();
      current("approver");
      if (
        scope !== "base" &&
        Object.keys(body.values).some((k) => data.layers.base.locked.includes(k as never))
      )
        error("SETTING_LOCKED", "An organization lock prevents this change.");
      const next = structuredClone(data.layers);
      next[scope] = {
        scope,
        values: body.values,
        locked: scope === "base" ? (body.locked ?? next.base.locked) : [],
        updatedAt: now(),
      };
      for (const role of ["buyer", "approver"] as const) {
        const merged = {
          ...defaultPreferences,
          ...next.base.values,
          ...Object.fromEntries(
            Object.entries(next[role].values).filter(
              ([key]) => !next.base.locked.includes(key as never),
            ),
          ),
        };
        if (
          merged.maxOrderValue !== null &&
          merged.autoApproveBelow !== null &&
          merged.autoApproveBelow > merged.maxOrderValue
        )
          throw new ApiError("Auto-approve threshold cannot exceed the order limit.", 422);
      }
      data.layers = next;
      save();
      return structuredClone(next[scope]);
    },
    async getMembers() {
      load();
      current("approver");
      return structuredClone({ members: data.members });
    },
    async createMember(body) {
      load();
      current("approver");
      if (data.members.some((m) => m.username === body.username))
        error("USERNAME_TAKEN", "This username is already in use.");
      const member = { userId: idOf("member"), username: body.username, roles: body.roles };
      data.members.push(member);
      save();
      return structuredClone(member);
    },
    async updateRoles(id, body) {
      load();
      current("approver");
      if (
        !body.roles.includes("approver") &&
        data.members.filter((m) => m.roles.includes("approver")).every((m) => m.userId === id)
      )
        error("LAST_APPROVER", "Keep at least one approver in your organization.");
      const member = data.members.find((m) => m.userId === id);
      if (!member) throw new ApiError("Member not found.", 404);
      member.roles = body.roles;
      if (data.user.id === id) data.user.roles = body.roles;
      save();
      return structuredClone(member);
    },
    async getAlerts(date) {
      return { checkedAt: now(), deliveryDate: date, alerts: [] };
    },
    async substitutions() {
      throw new ApiError(
        "No verified substitute was found. Review the ingredient manually.",
        422,
        "NO_SAFE_SUBSTITUTE",
      );
    },
    async extract(prompt) {
      return {
        items: [{ productName: prompt, productType: "Food", productQuantity: "unspecified" }],
      };
    },
  };
  function idOf(prefix: string) {
    return id(prefix);
  }
  return {
    api,
    initialPlans() {
      return [
        {
          id: "pizza-cheese",
          name: "Pizza & gratin cheese",
          ingredient: "Lighter pizza cheese",
          productId: "cheese",
          unit: "KG",
          current: 8,
          threshold: 12,
          target: 40,
          location: "Main kitchen",
          schedule: "threshold" as const,
          paused: false,
          inventoryId: "stock-cheese",
        },
        {
          id: "morning-milk",
          name: "Morning dairy milk",
          ingredient: "Nordic lactose-free milk, 1 L",
          productId: "milk",
          unit: "L",
          current: 30,
          threshold: 20,
          target: 100,
          location: "Breakfast kitchen",
          schedule: "weekly" as const,
          paused: false,
        },
        {
          id: "kitchen-butter",
          name: "Kitchen butter",
          ingredient: "Lactose-free kitchen butter",
          productId: "butter",
          unit: "KG",
          current: 1,
          threshold: 4,
          target: 10,
          location: "Main kitchen",
          schedule: "threshold" as const,
          paused: false,
          inventoryId: "stock-butter",
        },
        {
          id: "plant-cream",
          name: "Plant-based service",
          ingredient: "Plant-based whipping alternative",
          productId: "oat",
          unit: "L",
          current: 0,
          threshold: 1,
          target: 8,
          location: "Main kitchen",
          schedule: "threshold" as const,
          paused: false,
        },
      ];
    },
    setRoles(roles: Role[]) {
      load();
      data.user.roles = roles;
      save();
    },
    setFault(value: typeof fault) {
      fault = value;
    },
    reset() {
      data = initial();
      loaded = true;
      save();
    },
  };
}
