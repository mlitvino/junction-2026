// No `import "server-only"` here: drizzle-kit loads the schema outside Next.js, where it throws.
// Table definitions only, no secrets.
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { organization } from "./organization.ts";

// Preference layers of an organization (see shared/contracts/preferences.ts): `base`, `buyer`,
// `approver`. `settings` holds only the settings that layer sets (validated by the service);
// `locked` is only used on `base`. No row = the layer sets nothing.

export const preferenceLayer = pgTable(
  "preference_layer",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    locked: text("locked").array().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.scope] }),
    check("preference_layer_scope_check", sql`${t.scope} IN ('base', 'buyer', 'approver')`),
  ],
);
