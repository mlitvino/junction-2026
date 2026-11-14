import { z } from "zod";

// TODO BACKEND-CONTRACT: frontend-only DTOs; none are agreed server contracts.
export const MoneySchema = z.object({
  currency: z.literal("EUR"),
  amountMinor: z.string().regex(/^\d+$/),
});
const QuantitySchema = z.object({
  value: z.string().regex(/^\d+(\.\d+)?$/),
  unit: z.string().min(1),
});
const ReasonSchema = z.object({ code: z.string(), message: z.string() });
const VerificationSchema = z.enum(["PASS", "FAIL", "UNKNOWN"]);
export const ProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  language: z.string(),
  brand: z.string().optional(),
  salesUnit: z.string(),
  baseUnit: z.string(),
  allowedLotSize: z.string(),
  countryOfOrigin: z.string().optional(),
});
export const OfferSchema = z.object({
  productId: z.string(),
  requestedDate: z.iso.date(),
  priceGross: MoneySchema.nullable(),
  availableSalesUnits: z.string().nullable(),
  availableDate: z.iso.date().nullable(),
  salesUnit: z.string(),
  stockCertainty: z.enum([
    "STOCK_VERIFIED",
    "SUPPLIER_UNKNOWN",
    "OUT_OF_STOCK",
    "BLOCKED",
    "NOT_DELIVERABLE",
  ]),
  blocked: z.boolean(),
  errorCodes: z.array(z.string()),
  checkedAt: z.iso.datetime(),
  // Deliberate provisional provenance extension: these are NOT supplier API responses.
  source: z.literal("SYNTHETIC_FRONTEND_FIXTURE"),
});
const EvidenceSchema = z.object({
  productId: z.string(),
  match: VerificationSchema,
  constraintResults: z.array(
    z.object({
      code: z.string(),
      result: VerificationSchema,
      reason: z.string(),
      source: z.string(),
    }),
  ),
  physicalMeasureStatus: z.enum(["VERIFIED", "CURATED", "INFERRED", "UNKNOWN"]),
  offer: OfferSchema,
  selectionReason: z.string(),
});
export const IntentSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  status: z.enum(["DRAFT", "READY", "SUPERSEDED"]),
  originalText: z.string(),
  requestedDeliveryDate: z.iso.date(),
  budgetGross: MoneySchema,
  items: z.array(
    z.object({
      lineId: z.string(),
      query: z.string(),
      quantity: QuantitySchema,
      mandatoryClaims: z.array(z.string()),
      forbiddenAllergens: z.array(z.string()),
      allowSubstitutions: z.boolean(),
      allowPartialDelivery: z.boolean(),
    }),
  ),
  preferences: z.object({
    preferOrigin: z.string().nullable(),
    priceWeight: z.number(),
    reliabilityWeight: z.number(),
    carbonWeight: z.number(),
  }),
  needsClarification: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ProposalSchema = z.object({
  id: z.string(),
  intentId: z.string(),
  intentRevision: z.number().int().positive(),
  version: z.number().int().positive(),
  status: z.enum([
    "DRAFT",
    "READY",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "BLOCKED",
    "EXPIRED",
    "REAPPROVAL_REQUIRED",
    "COMMITTED_SIMULATED",
    "FAILED",
  ]),
  proposalHash: z.string(),
  lines: z.array(
    z.object({
      requestedLineId: z.string(),
      productId: z.string(),
      requestedQuantity: QuantitySchema,
      selectedSalesQuantity: QuantitySchema,
      estimatedPhysicalQuantity: QuantitySchema.nullable(),
      unitPriceGross: MoneySchema.nullable(),
      lineTotalGross: MoneySchema.nullable(),
      evidence: EvidenceSchema,
    }),
  ),
  alternatives: z.array(EvidenceSchema),
  totalGross: MoneySchema.nullable(),
  totalNet: MoneySchema.nullable(),
  unknownCharges: z.array(z.string()),
  policyDecision: z.object({
    outcome: z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY"]),
    reasons: z.array(ReasonSchema),
    evaluatedAt: z.iso.datetime(),
    policyVersion: z.number().int(),
  }),
  approvalId: z.string().nullable(),
  orderId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  traceId: z.string(),
});
export const ApprovalSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  proposalHash: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED"]),
  requestedAt: z.iso.datetime(),
  reasons: z.array(ReasonSchema),
  decidedByUserId: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  // Demo-local extensions, to reconcile with the backend.
  proposalVersion: z.number().int().positive(),
  note: z.string().nullable(),
});
export const OrderSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  status: z.literal("SIMULATED_CONFIRMED"),
  source: z.literal("LOCAL_SIMULATOR"),
  upstreamOrderId: z.null(),
  committedAt: z.iso.datetime(),
  totalGross: MoneySchema.nullable(),
  traceId: z.string(),
  proposalSnapshot: ProposalSchema,
  intentSnapshot: IntentSchema,
  auditEventIds: z.array(z.string()),
});
export const ActivitySchema = z.object({
  id: z.string(),
  timestamp: z.iso.datetime(),
  traceId: z.string(),
  actorType: z.enum(["USER", "AGENT", "SYSTEM"]),
  actorId: z.string(),
  action: z.string(),
  resourceId: z.string(),
  result: z.string(),
  explanation: z.string(),
});
const PhaseSchema = z.enum([
  "understanding",
  "catalog_search",
  "offer_check",
  "comparison",
  "policy_check",
  "approval",
  "commit",
]);
const envelope = {
  runId: z.string(),
  traceId: z.string(),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime(),
};
export const AgentEventSchema = z.discriminatedUnion("event", [
  z.object({
    ...envelope,
    event: z.literal("status"),
    data: z.object({ phase: PhaseSchema, message: z.string() }),
  }),
  z.object({
    ...envelope,
    event: z.literal("message.delta"),
    data: z.object({ text: z.string() }),
  }),
  z.object({
    ...envelope,
    event: z.literal("intent.ready"),
    data: z.object({ intent: IntentSchema }),
  }),
  z.object({
    ...envelope,
    event: z.literal("proposal.ready"),
    data: z.object({ proposal: ProposalSchema }),
  }),
  z.object({
    ...envelope,
    event: z.literal("approval.required"),
    data: z.object({ approval: ApprovalSchema }),
  }),
  z.object({
    ...envelope,
    event: z.literal("order.committed"),
    data: z.object({ order: OrderSchema }),
  }),
  z.object({
    ...envelope,
    event: z.literal("done"),
    data: z.object({
      conversationId: z.string(),
      intentId: z.string().optional(),
      proposalId: z.string().optional(),
      orderId: z.string().optional(),
    }),
  }),
  z.object({
    ...envelope,
    event: z.literal("error"),
    data: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
  }),
]);
export const ScenarioIdSchema = z.enum([
  "happy-path-auto",
  "human-approval-budget",
  "allergen-blocked",
]);
export const ScenarioSchema = z.object({
  id: ScenarioIdSchema,
  label: z.string(),
  description: z.string(),
  prompt: z.string(),
});
export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.iso.datetime(),
  scenarioId: ScenarioIdSchema,
  clientRequestId: z.string(),
  runId: z.string(),
  traceId: z.string(),
  status: z.enum(["RUNNING", "DONE", "INTERRUPTED", "FAILED"]),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  events: z.array(AgentEventSchema),
  intentId: z.string().nullable(),
  proposalId: z.string().nullable(),
  orderId: z.string().nullable(),
  error: z.string().nullable(),
});
export const DemoStateSchema = z.object({
  version: z.literal(1),
  nextId: z.number().int().positive(),
  role: z.enum(["BUYER", "APPROVER"]),
  activeConversationId: z.string().nullable(),
  conversations: z.array(ConversationSchema),
  intents: z.array(IntentSchema),
  proposals: z.array(ProposalSchema),
  approvals: z.array(ApprovalSchema),
  orders: z.array(OrderSchema),
  activities: z.array(ActivitySchema),
  commits: z.array(
    z.object({
      key: z.string(),
      proposalId: z.string(),
      expectedVersion: z.number().int(),
      orderId: z.string(),
    }),
  ),
});

export type ProvisionalMoney = z.infer<typeof MoneySchema>;
export type ProvisionalProduct = z.infer<typeof ProductSchema>;
export type ProvisionalEvidence = z.infer<typeof EvidenceSchema>;
export type ProvisionalIntent = z.infer<typeof IntentSchema>;
export type ProvisionalProposal = z.infer<typeof ProposalSchema>;
export type ProvisionalApproval = z.infer<typeof ApprovalSchema>;
export type ProvisionalOrder = z.infer<typeof OrderSchema>;
export type ProvisionalActivity = z.infer<typeof ActivitySchema>;
export type ProvisionalAgentEvent = z.infer<typeof AgentEventSchema>;
export type ProvisionalScenario = z.infer<typeof ScenarioSchema>;
export type ProvisionalConversation = z.infer<typeof ConversationSchema>;
export type ProvisionalDemoState = z.infer<typeof DemoStateSchema>;
export type ProvisionalRequest = {
  scenarioId: ProvisionalScenario["id"];
  message: string;
  clientRequestId: string;
};
export type ProvisionalSnapshot = {
  ready: boolean;
  mode: "mock" | "unavailable";
  storageNotice: string | null;
  state: ProvisionalDemoState;
  scenarios: readonly ProvisionalScenario[];
  products: readonly ProvisionalProduct[];
};

export interface ProvisionalProcurementService {
  initialize(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ProvisionalSnapshot;
  getServerSnapshot(): ProvisionalSnapshot;
  startConversation(request: ProvisionalRequest): Promise<string>;
  requestApproval(proposalId: string, expectedVersion: number): Promise<string>;
  commitOrder(proposalId: string, expectedVersion: number, idempotencyKey: string): Promise<string>;
  decideApproval(
    approvalId: string,
    expectedProposalHash: string,
    decision: "APPROVED" | "REJECTED",
    note: string,
  ): Promise<void>;
  setDemoRole(role: ProvisionalDemoState["role"]): Promise<void>;
  resetDemo(): Promise<void>;
}
