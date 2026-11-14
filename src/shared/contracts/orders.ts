import { z } from "zod";

import { PriceAvailabilityInquirySchema, StockStatusSchema } from "./catalog";
import { ExtractedProductItemSchema } from "./extract";
import {
  AgentGuardrailsSchema,
  CustomerPreferencesSchema,
  GuardrailEvaluationSchema,
  type CustomerPreferences,
  type NutritionPreferences,
  NutritionPreferencesSchema,
  type NutritionProfile,
  NutritionProfileSchema,
  PartialAgentGuardrailsSchema,
} from "./guardrails";

export {
  CustomerPreferencesSchema,
  NutritionPreferencesSchema,
  NutritionProfileSchema,
  type CustomerPreferences,
  type NutritionPreferences,
  type NutritionProfile,
};

/** Historical order entry used for sorting by previously ordered product and brand */
export const PreviousOrderRecordSchema = z.object({
  orderId: z.string().meta({ example: "ORD-HIST-001" }),
  orderedAt: z.string().meta({ example: "2026-10-25T09:30:00.000Z" }),
  productId: z.string().meta({ example: "460101" }),
  productName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  brand: z.string().meta({ example: "Valio" }),
  quantity: z.number().meta({ example: 100 }),
});

export type PreviousOrderRecord = z.infer<typeof PreviousOrderRecordSchema>;

/** Candidate product evaluated during the ordering pipeline */
export const CandidateProductSchema = z.object({
  id: z.string().meta({ example: "460101" }),
  name: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  productType: z.string().meta({ example: "Cheese" }),
  category: z.string().meta({ example: "CHEESE" }),
  brand: z.string().nullable().meta({ example: "Valio" }),
  vendorName: z.string().meta({ example: "Valio Oy" }),
  salesUnit: z.string().meta({ example: "KG" }),
  unitPriceEur: z.number().meta({ example: 5.4 }),
  unitPriceInclVatEur: z.number().optional().meta({ example: 6.16 }),
  vatRatePct: z.number().nullable().optional().meta({ example: 14 }),
  availableQuantity: z.number().nullable().optional().meta({ example: 500 }),
  stockStatus: StockStatusSchema.optional(),
  earliestAvailableDate: z.string().nullable().optional().meta({ example: "2026-11-16" }),
  deliveryReliability: z.number().min(0).max(1).nullable().optional().meta({ example: 0.98 }),
  co2PerKg: z.number().nullable().optional().meta({ example: 4.8 }),
  dietaryTags: z.array(z.string()).meta({ example: ["vegetarian", "gluten-free", "lactose-free"] }),
  allergens: z.array(z.string()).meta({ example: ["milk"] }),
  nutrition: NutritionProfileSchema,
  nameMatchScore: z.number().min(0).max(1).meta({
    description: "Similarity score (0–1) against the extracted product name.",
    example: 0.85,
  }),
  previouslyOrderedProduct: z.boolean().meta({
    description: "True if this specific product appears in the customer's previous orders.",
  }),
  previouslyOrderedBrand: z.boolean().meta({
    description: "True if this product's brand appears in the customer's previous orders.",
  }),
});

export type CandidateProduct = z.infer<typeof CandidateProductSchema>;

/** Product removed due to failing customer preference checks */
export const RemovedCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  reasons: z.array(z.string()).meta({
    description:
      "Reasons why the product was filtered out (dietary restriction, allergen, or nutrition).",
    example: ["Contains excluded allergen: soy"],
  }),
});

export type RemovedCandidate = z.infer<typeof RemovedCandidateSchema>;

/** Per-item procurement pipeline trace */
export const ItemProcurementTraceSchema = z.object({
  extractedItem: ExtractedProductItemSchema,
  parsedQuantity: z.number().meta({ example: 420 }),
  parsedUnit: z.string().meta({ example: "kg" }),
  matchedByTypeCount: z.number().int().meta({
    description:
      "Total products found matching the extracted productType before preference filtering.",
    example: 5,
  }),
  removedByPreferences: z.array(RemovedCandidateSchema).meta({
    description:
      "Products removed due to dietary restrictions, allergens, or nutrition mismatches.",
  }),
  sortedCandidates: z.array(CandidateProductSchema).meta({
    description:
      "Remaining candidates sorted by previous order history (product, then brand) and best match by productName.",
  }),
  selectedProduct: CandidateProductSchema.nullable().meta({
    description: "Top-ranked candidate chosen for the order line, or null if no candidate matched.",
  }),
});

export type ItemProcurementTrace = z.infer<typeof ItemProcurementTraceSchema>;

/** Order line item */
export const OrderLineItemSchema = z.object({
  productId: z.string().meta({ example: "460101" }),
  productName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  brand: z.string().nullable().meta({ example: "Valio" }),
  category: z.string().meta({ example: "CHEESE" }),
  productType: z.string().meta({ example: "Cheese" }),
  requestedProductName: z.string().meta({ example: "Creamy cheese" }),
  quantity: z.number().meta({ example: 420 }),
  unit: z.string().meta({ example: "KG" }),
  unitPriceEur: z.number().meta({
    description: "Fixed unit price excluding VAT in EUR confirmed by inquiry.",
    example: 5.4,
  }),
  unitPriceInclVatEur: z.number().meta({
    description: "Fixed unit price including VAT in EUR confirmed by inquiry.",
    example: 6.16,
  }),
  vatRatePct: z.number().meta({ example: 14 }),
  lineTotalEur: z.number().meta({
    description: "Line total excluding VAT in EUR.",
    example: 2268,
  }),
  lineTotalInclVatEur: z.number().meta({
    description: "Line total including VAT in EUR.",
    example: 2585.52,
  }),
  availableQuantity: z.number().nullable().meta({ example: 500 }),
  stockStatus: StockStatusSchema,
  earliestAvailableDate: z.string().nullable().meta({ example: "2026-11-16" }),
  nameMatchScore: z.number().meta({ example: 0.85 }),
  previouslyOrderedProduct: z.boolean(),
  previouslyOrderedBrand: z.boolean(),
});

export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;

/** Comparison of order total against customer budget */
export const BudgetComparisonSchema = z.object({
  budgetEur: z.number().meta({ description: "Customer budget limit in EUR.", example: 2500 }),
  totalPriceEur: z.number().meta({ description: "Total order cost in EUR.", example: 2268 }),
  currency: z.literal("EUR"),
  withinBudget: z.boolean().meta({
    description: "True when totalPriceEur is less than or equal to budgetEur.",
    example: true,
  }),
  remainingBudgetEur: z.number().meta({
    description: "Remaining budget (budgetEur - totalPriceEur); negative if over budget.",
    example: 232,
  }),
  exceededByEur: z.number().meta({
    description: "Amount by which totalPriceEur exceeds budgetEur (0 when within budget).",
    example: 0,
  }),
});

export type BudgetComparison = z.infer<typeof BudgetComparisonSchema>;

/** Order lifecycle statuses */
export const OrderStatusSchema = z
  .enum(["confirmed", "pending_approval", "approved", "rejected", "checked_out", "unfulfilled"])
  .meta({
    description:
      "'confirmed': authorized within agent permissions/budget and ready for checkout; " +
      "'pending_approval': paused awaiting human approver sign-off or order edits; " +
      "'approved': explicitly signed off by a human approver and ready for checkout; " +
      "'rejected': rejected by a human approver; " +
      "'checked_out': submitted to Valio Aimo with an issued receipt; " +
      "'unfulfilled': no valid products matched the request.",
    example: "confirmed",
  });

export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** Human approval state attached to an order */
export const OrderApprovalSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  requiredReasons: z.array(z.string()).meta({
    description: "Reasons why human approval was requested.",
  }),
  decidedAt: z.iso.datetime().nullable(),
  decidedByUserId: z.string().nullable(),
  decidedByName: z.string().nullable(),
  comment: z.string().nullable(),
});

export type OrderApproval = z.infer<typeof OrderApprovalSchema>;

/** Line item on an issued checkout receipt */
export const ReceiptLineItemSchema = z.object({
  productId: z.string().meta({ example: "460101" }),
  productName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  quantity: z.number().meta({ example: 420 }),
  unit: z.string().meta({ example: "KG" }),
  fixedUnitPriceExclVat: z.number().meta({ example: 5.4 }),
  vatRatePct: z.number().meta({ example: 14 }),
  lineTotalExclVat: z.number().meta({ example: 2268 }),
  lineVatAmount: z.number().meta({ example: 317.52 }),
  lineTotalInclVat: z.number().meta({ example: 2585.52 }),
  stockStatus: StockStatusSchema,
});

export type ReceiptLineItem = z.infer<typeof ReceiptLineItemSchema>;

/** Official receipt returned after order checkout */
export const OrderReceiptSchema = z.object({
  receiptId: z.string().meta({ example: "RCP-20261114-A1B2C3" }),
  orderId: z.string().meta({ example: "ORD-8A7B6C5D" }),
  supplierConfirmationId: z.string().meta({ example: "VALIO-CONF-948271" }),
  issuedAt: z.iso.datetime(),
  inquiryId: z.string().nullable().meta({
    description: "Reference to the fixed-price inquiry quote honored at checkout.",
    example: "INQ-9F3A1B2C",
  }),
  deliveryDate: z.iso.date().meta({ example: "2026-11-16" }),
  buyerOrganizationId: z.string().nullable(),
  checkedOutByName: z.string().nullable(),
  customerReference: z.string().nullable(),
  deliveryNotes: z.string().nullable(),
  authorizationSummary: z.string().meta({
    example: "Authorized autonomously within agent spending limit (2500 EUR).",
  }),
  paymentTerms: z.string().meta({ example: "Net 14 days (Valio Aimo B2B Fixed-Price Quote)" }),
  currency: z.literal("EUR"),
  subtotalExclVatEur: z.number().meta({ example: 2268 }),
  totalVatEur: z.number().meta({ example: 317.52 }),
  totalInclVatEur: z.number().meta({ example: 2585.52 }),
  lines: z.array(ReceiptLineItemSchema),
});

export type OrderReceipt = z.infer<typeof OrderReceiptSchema>;

/** Actor category in the procurement audit trail */
export const AuditActorTypeSchema = z.enum(["agent", "buyer", "approver", "system"]);

export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

/** Event types recorded in the human-readable procurement audit trail */
export const AuditEventTypeSchema = z.enum([
  "prompt_extracted",
  "catalog_searched",
  "preferences_filtered",
  "candidates_ranked",
  "price_availability_inquired",
  "guardrails_evaluated",
  "order_created",
  "approval_requested",
  "order_modified",
  "order_approved",
  "order_rejected",
  "order_checked_out",
]);

export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

/** Human-readable and machine-structured audit trail entry */
export const AuditTrailEventSchema = z.object({
  id: z.string().meta({ example: "AUD-1A2B3C4D" }),
  orderId: z.string().meta({ example: "ORD-8A7B6C5D" }),
  timestamp: z.iso.datetime(),
  actorType: AuditActorTypeSchema,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  eventType: AuditEventTypeSchema,
  summary: z.string().meta({
    description: "Human-readable explanation of what happened and why.",
    example:
      "Selected 'Valio Oltermanni Creamy Cheese 1kg' (460101) at 5.40 EUR/KG after filtering 3 non-compliant candidates and ranking by previous order history.",
  }),
  details: z.record(z.string(), z.unknown()).meta({
    description: "Structured audit evidence for verification.",
  }),
});

export type AuditTrailEvent = z.infer<typeof AuditTrailEventSchema>;

/** Suggested alternative candidate for swapping a line item in Step 8 */
export const SuggestedAlternativeSchema = z.object({
  forProductId: z.string().meta({ example: "460101" }),
  forProductName: z.string().meta({ example: "Valio Oltermanni Creamy Cheese 1kg" }),
  alternatives: z.array(CandidateProductSchema).meta({
    description:
      "Preference-compliant alternative products that can replace this line via PATCH /api/orders/{orderId}.",
  }),
});

export type SuggestedAlternative = z.infer<typeof SuggestedAlternativeSchema>;

/** Created / persisted procurement order object */
export const CreatedOrderSchema = z.object({
  orderId: z.string().meta({ example: "ORD-8A7B6C5D" }),
  organizationId: z.string().nullable().meta({ example: null }),
  createdByUserId: z.string().nullable().meta({ example: null }),
  status: OrderStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deliveryDate: z.iso.date().meta({ example: "2026-11-16" }),
  lines: z.array(OrderLineItemSchema),
  totalPriceEur: z.number().meta({
    description: "Total order amount excluding VAT in EUR.",
    example: 2268,
  }),
  totalPriceInclVatEur: z.number().meta({
    description: "Total order amount including VAT in EUR.",
    example: 2585.52,
  }),
  currency: z.literal("EUR"),
  budgetComparison: BudgetComparisonSchema,
  guardrailsUsed: AgentGuardrailsSchema,
  guardrailEvaluation: GuardrailEvaluationSchema,
  inquiry: PriceAvailabilityInquirySchema.nullable(),
  approval: OrderApprovalSchema.nullable(),
  receipt: OrderReceiptSchema.nullable(),
  customerReviewPrompt: z.string().meta({
    description:
      "Human-readable prompt explaining next actions (approve, swap product X for Y, or checkout).",
  }),
  auditTrail: z.array(AuditTrailEventSchema),
});

export type CreatedOrder = z.infer<typeof CreatedOrderSchema>;

/** POST /api/orders — request body */
export const CreateOrderFromPromptRequestSchema = z.object({
  prompt: z.string().trim().min(1).meta({
    description: "Free-form natural-language purchasing request from the user.",
    example: "I want to buy 420 kg of creamy cheese",
  }),
  deliveryDate: z.iso.date().optional().meta({
    description: "Desired delivery date (YYYY-MM-DD). Defaults to today's date.",
    example: "2026-11-16",
  }),
  preferences: CustomerPreferencesSchema.optional().meta({
    description: "Optional customer preferences override (defaults to saved org/mock preferences).",
  }),
  budgetEur: z.number().positive().optional().meta({
    description: "Optional customer budget in EUR override.",
    example: 2500,
  }),
  guardrails: PartialAgentGuardrailsSchema.optional().meta({
    description: "Optional agent permission guardrails override.",
  }),
  previousOrders: z.array(PreviousOrderRecordSchema).optional().meta({
    description: "Optional previous orders override (defaults to historical order data).",
  }),
  requireApproval: z.boolean().optional().meta({
    description:
      "If true, pauses the created order in pending_approval so the user must explicitly approve or modify before checkout.",
  }),
});

export type CreateOrderFromPromptRequest = z.infer<typeof CreateOrderFromPromptRequestSchema>;

/** POST /api/orders — response body */
export const CreateOrderFromPromptResponseSchema = z.object({
  prompt: z.string(),
  extractedItems: z.array(ExtractedProductItemSchema),
  preferencesUsed: CustomerPreferencesSchema,
  previousOrdersUsed: z.array(PreviousOrderRecordSchema),
  pipeline: z.array(ItemProcurementTraceSchema),
  suggestedAlternatives: z.array(SuggestedAlternativeSchema),
  order: CreatedOrderSchema,
});

export type CreateOrderFromPromptResponse = z.infer<typeof CreateOrderFromPromptResponseSchema>;

/** GET /api/orders — response body */
export const OrderListResponseSchema = z.object({
  orders: z.array(CreatedOrderSchema),
});

export type OrderListResponse = z.infer<typeof OrderListResponseSchema>;

/** GET /api/orders/{orderId} — response body */
export const OrderDetailResponseSchema = z.object({
  prompt: z.string(),
  extractedItems: z.array(ExtractedProductItemSchema),
  preferencesUsed: CustomerPreferencesSchema,
  previousOrdersUsed: z.array(PreviousOrderRecordSchema),
  pipeline: z.array(ItemProcurementTraceSchema),
  suggestedAlternatives: z.array(SuggestedAlternativeSchema),
  order: CreatedOrderSchema,
});

export type OrderDetailResponse = z.infer<typeof OrderDetailResponseSchema>;

/** Product swap instruction (change product X to product Y) */
export const OrderProductReplacementSchema = z.object({
  fromProductId: z.string().trim().min(1).meta({
    description: "Existing product ID in the order to replace.",
    example: "460101",
  }),
  toProductId: z.string().trim().min(1).meta({
    description: "Replacement product ID to use instead.",
    example: "460301",
  }),
  quantity: z.number().positive().optional().meta({
    description: "Optional new quantity; keeps the existing line's quantity when omitted.",
    example: 420,
  }),
});

export type OrderProductReplacement = z.infer<typeof OrderProductReplacementSchema>;

/** Quantity change instruction on an existing order line */
export const OrderQuantityUpdateSchema = z.object({
  productId: z.string().trim().min(1).meta({ example: "460101" }),
  quantity: z.number().positive().meta({ example: 300 }),
});

export type OrderQuantityUpdate = z.infer<typeof OrderQuantityUpdateSchema>;

/** Add line instruction on an existing order */
export const OrderAddItemSchema = z.object({
  productId: z.string().trim().min(1).meta({ example: "460202" }),
  quantity: z.number().positive().meta({ example: 50 }),
});

export type OrderAddItem = z.infer<typeof OrderAddItemSchema>;

/** PATCH /api/orders/{orderId} — modify order lines via structured instructions or natural language */
export const ModifyOrderRequestSchema = z.object({
  prompt: z.string().trim().min(1).optional().meta({
    description:
      "Optional natural-language modification request, e.g. 'Change product 460101 to 460301 and set quantity to 350 kg'.",
    example: "Change Valio Oltermanni to Arla Creamy Havarti",
  }),
  replacements: z.array(OrderProductReplacementSchema).optional().meta({
    description: "Explicit product X -> product Y replacements.",
  }),
  quantityUpdates: z.array(OrderQuantityUpdateSchema).optional().meta({
    description: "Explicit quantity adjustments for existing order lines.",
  }),
  removeProductIds: z.array(z.string().trim().min(1)).optional().meta({
    description: "Product IDs to remove from the order.",
  }),
  addItems: z.array(OrderAddItemSchema).optional().meta({
    description: "Additional product IDs and quantities to add to the order.",
  }),
  deliveryDate: z.iso.date().optional().meta({
    description: "Optional updated delivery date (re-runs fixed-price & availability inquiry).",
  }),
  allowPreferenceOverride: z.boolean().optional().meta({
    description:
      "If true, permits swapping in a product even if it violates saved dietary/allergen/nutrition preferences (forces pending_approval).",
    example: false,
  }),
});

export type ModifyOrderRequest = z.infer<typeof ModifyOrderRequestSchema>;

/** PATCH /api/orders/{orderId} — response body */
export const ModifyOrderResponseSchema = z.object({
  appliedChangesSummary: z.array(z.string()).meta({
    description: "Human-readable descriptions of every modification applied to the order.",
  }),
  suggestedAlternatives: z.array(SuggestedAlternativeSchema),
  order: CreatedOrderSchema,
});

export type ModifyOrderResponse = z.infer<typeof ModifyOrderResponseSchema>;

/** POST /api/orders/{orderId}/approval — human sign-off or rejection */
export const ApproveOrderRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]).meta({
    description: "'approve' authorizes the order for checkout; 'reject' cancels it.",
    example: "approve",
  }),
  comment: z.string().trim().max(500).optional().meta({
    description: "Optional note from the human approver recorded in the audit trail.",
    example: "Approved extra cheese volume for weekend catering event.",
  }),
  approverName: z.string().trim().max(120).optional().meta({
    description: "Optional display name when approving without a session cookie.",
    example: "Head Chef Maria",
  }),
});

export type ApproveOrderRequest = z.infer<typeof ApproveOrderRequestSchema>;

/** POST /api/orders/{orderId}/approval — response body */
export const ApproveOrderResponseSchema = z.object({
  order: CreatedOrderSchema,
});

export type ApproveOrderResponse = z.infer<typeof ApproveOrderResponseSchema>;

/** POST /api/orders/{orderId}/checkout — submit authorized order and issue receipt */
export const CheckoutOrderRequestSchema = z.object({
  customerReference: z.string().trim().max(120).optional().meta({
    description: "Optional PO number or kitchen reference printed on the receipt.",
    example: "PO-2026-KITCHEN-42",
  }),
  deliveryNotes: z.string().trim().max(500).optional().meta({
    description: "Optional unloading or delivery instructions.",
    example: "Deliver to loading dock B before 09:00.",
  }),
});

export type CheckoutOrderRequest = z.infer<typeof CheckoutOrderRequestSchema>;

/** POST /api/orders/{orderId}/checkout — response body */
export const CheckoutOrderResponseSchema = z.object({
  order: CreatedOrderSchema,
  receipt: OrderReceiptSchema,
});

export type CheckoutOrderResponse = z.infer<typeof CheckoutOrderResponseSchema>;

/** GET /api/orders/{orderId}/audit — response body */
export const OrderAuditResponseSchema = z.object({
  orderId: z.string(),
  status: OrderStatusSchema,
  auditTrail: z.array(AuditTrailEventSchema),
});

export type OrderAuditResponse = z.infer<typeof OrderAuditResponseSchema>;
