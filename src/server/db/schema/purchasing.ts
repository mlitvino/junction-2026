// No `import "server-only"` here: drizzle-kit loads the schema outside Next.js, where it throws.
// Table definitions only, no secrets.
import { sql } from "drizzle-orm";
import { check, date, doublePrecision, index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { organization } from "./organization.ts";

// Purchasing flow (shared/contracts/purchasing.ts): proposal → approval → order.
// A proposal's lines, prices, total and decision are frozen at creation (`hash` covers them);
// only `status` and `updated_at` change. One approval and at most one order per proposal.

const tz = { withTimezone: true } as const;
const uuid = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);
const org = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

/** Frozen line: see ProposalLineSchema. */
export type StoredProposalLine = {
  productId: string;
  name: string;
  vendorName: string;
  quantity: number;
  salesUnit: string | null;
  unitPriceExclVat: number | null;
  lineTotalExclVat: number | null;
  /** Availability on the requested date when the proposal was made (absent on older rows). */
  orderable?: boolean | null;
  availableDate?: string | null;
  availableQuantity?: number | null;
};

/** Frozen decision: see ProposalDecisionSchema. */
export type StoredDecision = {
  outcome: "ALLOW" | "REQUIRE_APPROVAL" | "DENY";
  reasons: { code: string; outcome: string; message: string; setting?: string; productId?: string }[];
  limits: { maxOrderValue: number | null; autoApproveBelow: number | null; autonomy: string };
  evaluatedAt: string;
};

export const proposal = pgTable(
  "proposal",
  {
    id: uuid(),
    organizationId: org(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    lines: jsonb("lines").$type<StoredProposalLine[]>().notNull(),
    totalExclVat: doublePrecision("total_excl_vat"),
    currency: text("currency").notNull(),
    pricingDate: date("pricing_date", { mode: "string" }).notNull(),
    priceSource: text("price_source").notNull(),
    outcome: text("outcome").notNull(),
    decision: jsonb("decision").$type<StoredDecision>().notNull(),
    hash: text("hash").notNull(),
    note: text("note"),
    /** Frozen prices can be approved and ordered until then. Null on rows from before it existed. */
    quoteExpiresAt: timestamp("quote_expires_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("proposal_org_status_idx").on(t.organizationId, t.status, t.createdAt.desc()),
    check(
      "proposal_status_check",
      sql`${t.status} IN ('READY', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'BLOCKED', 'ORDERED', 'CANCELLED')`,
    ),
    check("proposal_outcome_check", sql`${t.outcome} IN ('ALLOW', 'REQUIRE_APPROVAL', 'DENY')`),
  ],
);

export const approval = pgTable(
  "approval",
  {
    id: uuid(),
    proposalId: text("proposal_id")
      .notNull()
      .unique()
      .references(() => proposal.id, { onDelete: "cascade" }),
    organizationId: org(),
    proposalHash: text("proposal_hash").notNull(),
    status: text("status").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", tz).notNull().defaultNow(),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", tz),
    comment: text("comment"),
  },
  (t) => [
    index("approval_org_status_idx").on(t.organizationId, t.status, t.requestedAt.desc()),
    check("approval_status_check", sql`${t.status} IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`),
  ],
);

export const purchaseOrder = pgTable(
  "purchase_order",
  {
    id: uuid(),
    proposalId: text("proposal_id")
      .notNull()
      .unique()
      .references(() => proposal.id, { onDelete: "cascade" }),
    organizationId: org(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    proposalHash: text("proposal_hash").notNull(),
    status: text("status").notNull().default("SIMULATED_CONFIRMED"),
    source: text("source").notNull().default("LOCAL_SIMULATOR"),
    lines: jsonb("lines").$type<StoredProposalLine[]>().notNull(),
    totalExclVat: doublePrecision("total_excl_vat"),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("purchase_order_idempotency_key").on(t.organizationId, t.idempotencyKey),
    index("purchase_order_org_created_idx").on(t.organizationId, t.createdAt.desc()),
  ],
);

export type ProposalRow = typeof proposal.$inferSelect;
export type ApprovalRow = typeof approval.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrder.$inferSelect;
