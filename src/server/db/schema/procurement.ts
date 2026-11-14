// No `import "server-only"` here: drizzle-kit and Node migration scripts load the schema outside Next.js.
// Table definitions only, no secrets. Use relative .ts imports (plain Node doesn't resolve @/).
import { doublePrecision, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { organization } from "./organization.ts";

const tz = { withTimezone: true } as const;

/**
 * Per-organization customer preferences (dietary, allergens, nutrition) and agent permission
 * guardrails (spending limits, allowed/blocked categories & products, approval rules).
 */
export const organizationProcurementSettings = pgTable("organization_procurement_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull(),
  guardrails: jsonb("guardrails").$type<Record<string, unknown>>().notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/**
 * Procurement orders created by buyers or external purchasing agents, including fixed-price
 * inquiry snapshots, guardrail evaluations, human approval state, and issued receipts.
 */
export const procurementOrder = pgTable(
  "procurement_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    prompt: text("prompt").notNull(),
    deliveryDate: text("delivery_date").notNull(),
    currency: text("currency").notNull().default("EUR"),
    totalPriceEur: doublePrecision("total_price_eur").notNull(),
    totalPriceInclVatEur: doublePrecision("total_price_incl_vat_eur").notNull().default(0),
    /** Full serialized order record (lines, pipeline trace, inquiry, guardrails, approval, receipt). */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("procurement_order_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("procurement_order_status_idx").on(t.status),
  ],
);

/**
 * Append-only human-readable and machine-structured audit trail for every procurement order.
 */
export const procurementAuditEvent = pgTable(
  "procurement_audit_event",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => procurementOrder.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("procurement_audit_event_order_idx").on(t.orderId, t.createdAt.asc())],
);

export type OrganizationProcurementSettingsRow =
  typeof organizationProcurementSettings.$inferSelect;
export type ProcurementOrderRow = typeof procurementOrder.$inferSelect;
export type ProcurementAuditEventRow = typeof procurementAuditEvent.$inferSelect;
