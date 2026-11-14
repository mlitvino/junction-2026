// No `import "server-only"` here: drizzle-kit and Node migration scripts load the schema outside Next.js.
// Table definitions only, no secrets. Use relative .ts imports (plain Node doesn't resolve @/).
import { doublePrecision, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { organization } from "./organization.ts";

const tz = { withTimezone: true } as const;

// The retired procurement_order, procurement_audit_event and organization_procurement_settings
// tables (unused since the purchasing flow was unified) were dropped in migration 0010.

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

export type ProcurementInventoryItemRow = typeof procurementInventoryItem.$inferSelect;
export type ProcurementRecipeRow = typeof procurementRecipe.$inferSelect;
