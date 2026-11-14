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

/**
 * Customer kitchen / warehouse ingredient inventory (e.g. restaurant, school canteen).
 * Used by the recipe-to-order pipeline (`actuallyNeeded = totalNeeded - inventoryStock`)
 * and proactive stock-out monitoring.
 */
export const procurementInventoryItem = pgTable(
  "procurement_inventory_item",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    ingredientName: text("ingredient_name").notNull(),
    productType: text("product_type").notNull(),
    linkedProductId: text("linked_product_id"),
    quantityInStock: doublePrecision("quantity_in_stock").notNull().default(0),
    unit: text("unit").notNull(),
    minParLevel: doublePrecision("min_par_level"),
    location: text("location"),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("procurement_inventory_org_idx").on(t.organizationId, t.productType)],
);

/**
 * Trusted Valio recipe book entries (`organization_id IS NULL`) and customer-provided
 * organization recipes (`organization_id` set) for menu/recipe-to-order procurement.
 */
export const procurementRecipe = pgTable(
  "procurement_recipe",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    source: text("source").notNull().default("customer"),
    description: text("description"),
    baseServings: doublePrecision("base_servings").notNull().default(10),
    ingredients: jsonb("ingredients").$type<Array<Record<string, unknown>>>().notNull(),
    instructions: text("instructions"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("procurement_recipe_org_idx").on(t.organizationId, t.name)],
);

export type OrganizationProcurementSettingsRow =
  typeof organizationProcurementSettings.$inferSelect;
export type ProcurementOrderRow = typeof procurementOrder.$inferSelect;
export type ProcurementAuditEventRow = typeof procurementAuditEvent.$inferSelect;
export type ProcurementInventoryItemRow = typeof procurementInventoryItem.$inferSelect;
export type ProcurementRecipeRow = typeof procurementRecipe.$inferSelect;
