import { z } from "zod";

import { ExtractedProductItemSchema } from "./extract";
import { ItemProcurementTraceSchema, PreviousOrderRecordSchema, SuggestedAlternativeSchema } from "./selection";
import { PolicyOutcomeSchema, PolicyReasonSchema } from "./policy";
import { DataSourceSchema } from "./products";

// Purchasing flow: proposal → (approval) → order. A proposal freezes products, quantities, prices
// and the policy decision; it never changes afterwards (to change it, create a new one and cancel
// the old). Amounts are EUR excluding VAT, like the policy check. Orders are simulated: Valio has
// no ordering API.

const id = z.string().meta({ example: "8b0c6c1e-5d7e-4f53-9f7e-2a3d2c1b9a10" });
const isoDateTime = z.iso.datetime();
const productId = z.string().min(1).meta({ description: "Valio product code.", example: "469330" });

export const ProposalStatusSchema = z.enum([
  "READY",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "BLOCKED",
  "ORDERED",
  "CANCELLED",
  "EXPIRED",
]).meta({
  description:
    "`READY`: allowed, or waiting to be sent for approval. `PENDING_APPROVAL`: an approver must decide. " +
    "`APPROVED` / `REJECTED`: decided. `BLOCKED`: the policy denied it (final). `ORDERED`: an order exists. " +
    "`CANCELLED`: withdrawn by its creator. `EXPIRED`: nobody decided before the quote expired (final; create a new proposal).",
});

export const ApprovalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]).meta({
  description: "`EXPIRED`: not decided before `expiresAt` (the proposal's quote expiry).",
});

export const ProposalLineSchema = z.object({
  productId,
  name: z.string(),
  vendorName: z.string(),
  quantity: z.number().meta({ description: "In the product's sales unit." }),
  salesUnit: z.string().nullable(),
  unitPriceExclVat: z.number().nullable(),
  lineTotalExclVat: z.number().nullable(),
  orderable: z.boolean().nullable().meta({ description: "Availability when the proposal was made; null = Valio gave no answer." }),
  availableDate: z.string().nullable().meta({ description: "Earliest delivery date when the proposal was made." }),
  availableQuantity: z.number().nullable().meta({ description: "In salesUnit; null when unknown." }),
  substituteFor: z
    .object({ requested: z.string(), reason: z.enum(["split", "swap", "fallback"]) })
    .nullable()
    .optional()
    .meta({ description: "What this line stands in for; null (or absent) when it is what was asked for." }),
  priceSnapshotId: z.string().nullable().optional().meta({
    description: "Id of the recorded Valio price answer the price comes from (absent on older proposals).",
  }),
  availabilitySnapshotId: z.string().nullable().optional().meta({
    description: "Id of the recorded Valio availability answer (absent on older proposals).",
  }),
});

export const ProposalDecisionSchema = z.object({
  outcome: PolicyOutcomeSchema,
  reasons: z.array(PolicyReasonSchema),
  limits: z.object({
    maxOrderValue: z.number().nullable(),
    autoApproveBelow: z.number().nullable(),
    autonomy: z.enum(["suggest_only", "order_within_limits"]),
  }),
  evaluatedAt: isoDateTime,
});

export const ApprovalSchema = z.object({
  id,
  proposalId: id,
  proposalHash: z.string().meta({ description: "The exact proposal content this approval is for." }),
  status: ApprovalStatusSchema,
  requestedBy: z.string(),
  requestedByName: z.string().nullable().meta({ description: "Username of the requester.", example: "alice" }),
  requestedAt: isoDateTime,
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable().meta({ description: "Username of the approver who decided.", example: "bob" }),
  decidedAt: isoDateTime.nullable(),
  comment: z.string().nullable(),
  expiresAt: isoDateTime.nullable().optional().meta({ description: "A pending approval expires then (the proposal's quote expiry)." }),
});

export const ProposalSourceSchema = z.enum(["buyer", "agent", "recipe"]).meta({
  description: "`buyer`: lines given directly. `agent`: chosen by the purchasing agent from a prompt. `recipe`: from a recipe.",
});

/** How the agent chose the lines: per requested item, the candidates, filters and ranking. */
export const ProposalSelectionSchema = z.object({
  prompt: z.string().nullable().meta({ description: "The request the lines were chosen for." }),
  extractedItems: z.array(ExtractedProductItemSchema),
  pipeline: z.array(ItemProcurementTraceSchema),
  suggestedAlternatives: z.array(SuggestedAlternativeSchema),
  previousOrdersUsed: z.array(PreviousOrderRecordSchema),
  warnings: z.array(z.string()).meta({
    description: "Things a human should check, e.g. quantity unit differs from the sales unit, unusual quantity vs history.",
  }),
});

export const ProposalSchema = z.object({
  id,
  status: ProposalStatusSchema,
  createdBy: z.string().meta({ description: "User id of the buyer who created it." }),
  createdByName: z.string().nullable().meta({ description: "Username of the buyer.", example: "alice" }),
  source: ProposalSourceSchema.nullable(),
  selection: ProposalSelectionSchema.nullable().meta({ description: "Null when the lines were given directly." }),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  lines: z.array(ProposalLineSchema),
  totalExclVat: z.number().nullable(),
  currency: z.string(),
  pricingDate: z.iso.date().meta({ description: "The requested delivery date; prices and availability are for it." }),
  priceSource: DataSourceSchema,
  quoteExpiresAt: isoDateTime.nullable().meta({
    description:
      "The frozen prices can be sent for approval, approved and ordered until then (24 h). After it: 409 `QUOTE_EXPIRED`, create a new proposal.",
  }),
  decision: ProposalDecisionSchema,
  hash: z.string().meta({ description: "SHA-256 of the frozen content (lines, prices, total, decision)." }),
  signature: z.string().nullable().optional().meta({
    description:
      "Ed25519 signature (base64url) over id and hash; verify it with `GET /api/trust/public-key`. Null on older proposals.",
  }),
  signatureKeyId: z.string().nullable().optional().meta({ description: "Which server key signed it." }),
  note: z.string().nullable(),
  approval: ApprovalSchema.nullable(),
  orderId: id.nullable(),
});

export const OrderSchema = z.object({
  id,
  proposalId: id,
  status: z.literal("SIMULATED_CONFIRMED"),
  source: z.literal("LOCAL_SIMULATOR").meta({ description: "Not sent to Valio: there is no ordering API." }),
  createdBy: z.string(),
  createdByName: z.string().nullable(),
  createdAt: isoDateTime,
  idempotencyKey: z.string(),
  proposalHash: z.string(),
  lines: z.array(ProposalLineSchema),
  totalExclVat: z.number().nullable(),
  currency: z.string(),
});

// ---------- Requests ----------

export const CreateProposalRequestSchema = z.object({
  lines: z
    .array(
      z.object({
        productId,
        quantity: z.number().positive().meta({ example: 20 }),
        substituteFor: z
        .object({
          requested: z.string().meta({ description: "What was asked for (requested name or product)." }),
          reason: z.enum(["split", "swap", "fallback"]).meta({
            description: "`split`: part of a short-stock split; `swap`: replaced on request; `fallback`: the best match can't be delivered.",
          }),
        })
        .optional()
        .meta({ description: "Set when this line stands in for what was requested. Needs approval unless `allowSubstitutes`." }),
      }),
    )
    .min(1)
    .max(50),
  date: z.iso.date().optional().meta({
    description: "The delivery date the goods are needed; prices and availability are checked for it. Defaults to today (Helsinki).",
  }),
  note: z.string().trim().max(1000).optional(),
});

export const ListProposalsQuerySchema = z.object({
  status: ProposalStatusSchema.optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .meta({ description: "`true`: only proposals you created." }),
});

export const PlaceOrderRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(200).meta({
    description: "Generated by the client once per order attempt. Repeating it returns the same order.",
    example: "2f6a7d2e-1c9b-4a55-8f2b-6b1f1d9e0c3a",
  }),
});

export const ListApprovalsQuerySchema = z.object({ status: ApprovalStatusSchema.optional() });

export const PendingApprovalCountSchema = z.object({
  count: z.number().int().meta({ description: "Approvals waiting for a decision (expired ones not counted).", example: 2 }),
  nextExpiresAt: isoDateTime.nullable().meta({ description: "When the first of them expires; null when none." }),
});

export const DecideApprovalRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    proposalHash: z.string().meta({ description: "The `hash` of the proposal you reviewed." }),
    comment: z.string().trim().max(1000).optional().meta({ description: "Required when rejecting." }),
  })
  .refine((v) => v.decision === "APPROVED" || !!v.comment, {
    message: "A comment is required to reject",
    path: ["comment"],
  });

export const ApprovalWithProposalSchema = ApprovalSchema.extend({ proposal: ProposalSchema });

export const ProposalListSchema = z.object({ items: z.array(ProposalSchema) });
export const ApprovalListSchema = z.object({ items: z.array(ApprovalWithProposalSchema) });
export const OrderListSchema = z.object({ items: z.array(OrderSchema) });

export const PurchasingErrorSchema = z.object({
  error: z.string(),
  code: z.string().meta({ example: "INVALID_STATE" }),
});

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export type ProposalLine = z.infer<typeof ProposalLineSchema>;
export type ProposalDecision = z.infer<typeof ProposalDecisionSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type CreateProposalRequest = z.infer<typeof CreateProposalRequestSchema>;
export type ListProposalsQuery = z.infer<typeof ListProposalsQuerySchema>;
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;
export type ListApprovalsQuery = z.infer<typeof ListApprovalsQuerySchema>;
export type PendingApprovalCount = z.infer<typeof PendingApprovalCountSchema>;
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequestSchema>;
export type ApprovalWithProposal = z.infer<typeof ApprovalWithProposalSchema>;

// ---------- Agent-prepared proposals ----------

export const CreateProposalFromPromptRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000).meta({
    description: "Natural-language request; the agent extracts items, picks products and creates a proposal.",
    example: "100 litres of lactose-free milk for Friday",
  }),
  date: z.iso.date().optional().meta({ description: "Delivery date the goods are needed. Defaults to today (Helsinki)." }),
  autoResolvePartialStock: z.boolean().optional().meta({
    description: "Split a line across compliant alternatives when known stock is short.",
  }),
});

export const ProposalFromPromptResponseSchema = z.object({
  proposal: ProposalSchema.nullable().meta({ description: "Null when no product matched; see `message`." }),
  selection: ProposalSelectionSchema,
  message: z.string().meta({ description: "What happened and what to do next, for a human or an agent." }),
});

const ReplacementSchema = z.object({
  fromProductId: productId,
  toProductId: productId,
  quantity: z.number().positive().optional(),
});

export const ReviseProposalRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000).optional().meta({
    description: "Natural-language change, e.g. 'Change 469330 to 469386 and set 30 cases'.",
  }),
  replacements: z.array(ReplacementSchema).optional(),
  quantityUpdates: z.array(z.object({ productId, quantity: z.number().positive() })).optional(),
  removeProductIds: z.array(productId).optional(),
  addItems: z.array(z.object({ productId, quantity: z.number().positive() })).optional(),
  date: z.iso.date().optional().meta({ description: "New delivery date (re-prices everything)." }),
});

export const ReviseProposalResponseSchema = z.object({
  previousProposalId: id,
  previousCancelled: z.boolean().optional().meta({
    description:
      "True when the previous proposal was cancelled (replaced). False when the revision is BLOCKED by policy: " +
      "the previous proposal then stays as it was and can still be used. Always sent by the server.",
  }),
  appliedChanges: z.array(z.string()),
  proposal: ProposalSchema,
});

// ---------- Receipts and verification ----------

export const OrderReceiptSchema = z.object({
  orderId: id,
  proposalId: id,
  issuedAt: isoDateTime,
  organizationName: z.string(),
  orderedByName: z.string().nullable(),
  approvedByName: z.string().nullable().meta({ description: "Null when no approval was needed." }),
  deliveryDate: z.iso.date(),
  lines: z.array(ProposalLineSchema),
  totalExclVat: z.number().nullable(),
  currency: z.string(),
  status: z.literal("SIMULATED_CONFIRMED"),
  source: z.literal("LOCAL_SIMULATOR"),
  proposalHash: z.string(),
  proposalSignature: z.string().nullable().optional().meta({ description: "The proposal's Ed25519 signature (see `GET /api/trust/public-key`)." }),
  signatureKeyId: z.string().nullable().optional(),
});

export const ProposalVerificationSchema = z.object({
  proposalId: id,
  storedHash: z.string(),
  recomputedHash: z.string(),
  hashValid: z.boolean().meta({ description: "True when the stored content still produces the stored hash." }),
  signatureValid: z.boolean().nullable().optional().meta({
    description: "True when the signature matches id and hash under the server's key; null when unsigned.",
  }),
  signatureKeyId: z.string().nullable().optional(),
  lines: z.array(
    z.object({
      productId,
      unitPriceExclVat: z.number().nullable(),
      priceSnapshotId: z.string().nullable().optional().meta({ description: "The matched price snapshot." }),
      availabilitySnapshotId: z.string().nullable().optional(),
      snapshotFound: z.boolean().meta({
        description: "The recorded Valio price answer exists and has this price, product and date (by snapshot id; older proposals: by price).",
      }),
      snapshotFetchedAt: isoDateTime.nullable(),
      source: DataSourceSchema.nullable(),
    }),
  ),
  verifiedAt: isoDateTime,
});

// ---------- Audit log ----------

export const AuditEventSchema = z.object({
  id,
  actorType: z.enum(["user", "agent", "system"]),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string().meta({ example: "proposal.created" }),
  resourceType: z.string().meta({ example: "proposal" }),
  resourceId: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
  createdAt: isoDateTime,
});

export const AuditQuerySchema = z.object({
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const AuditListSchema = z.object({ items: z.array(AuditEventSchema) });

export type ProposalSource = z.infer<typeof ProposalSourceSchema>;
export type ProposalSelection = z.infer<typeof ProposalSelectionSchema>;
export type CreateProposalFromPromptRequest = z.infer<typeof CreateProposalFromPromptRequestSchema>;
export type ProposalFromPromptResponse = z.infer<typeof ProposalFromPromptResponseSchema>;
export type ReviseProposalRequest = z.infer<typeof ReviseProposalRequestSchema>;
export type ReviseProposalResponse = z.infer<typeof ReviseProposalResponseSchema>;
export type OrderReceipt = z.infer<typeof OrderReceiptSchema>;
export type ProposalVerification = z.infer<typeof ProposalVerificationSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
