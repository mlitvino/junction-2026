// No `import "server-only"` here: drizzle-kit loads the schema outside Next.js, where it throws.
// Table definitions only, no secrets.
import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";

// Organizations and per-organization roles (our tables, not Better Auth's organization plugin).
// One organization per user (UNIQUE user_id). Roles: see server/auth/roles.ts.

export const organization = pgTable("organization", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMember = pgTable(
  "organization_member",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    roles: text("roles").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    check("organization_member_roles_check", sql`${t.roles} <@ ARRAY['buyer', 'approver']::text[] AND cardinality(${t.roles}) > 0`),
  ],
);
