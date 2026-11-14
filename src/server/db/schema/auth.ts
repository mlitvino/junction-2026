// No `import "server-only"` here: drizzle-kit loads the schema outside Next.js, where it throws.
// Table definitions only, no secrets.
import { boolean, foreignKey, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

// Better Auth's tables (used through its Drizzle adapter in server/auth/auth.ts).
// Columns, constraint and index names match exactly what Better Auth created before Drizzle,
// so the first migration (drizzle/0000_*) is a no-op on databases that already have them.
// Change only when Better Auth needs new fields (e.g. a new plugin): see its schema docs.

const createdAt = () => timestamp("createdAt", { withTimezone: true }).notNull().defaultNow();

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("emailVerified").notNull(),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
    // username plugin
    username: text("username"),
    displayUsername: text("displayUsername"),
  },
  (t) => [unique("user_email_key").on(t.email), unique("user_username_key").on(t.username)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId").notNull(),
  },
  (t) => [
    unique("session_token_key").on(t.token),
    foreignKey({ name: "session_userId_fkey", columns: [t.userId], foreignColumns: [user.id] }).onDelete("cascade"),
    index("session_userId_idx").on(t.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({ name: "account_userId_fkey", columns: [t.userId], foreignColumns: [user.id] }).onDelete("cascade"),
    index("account_userId_idx").on(t.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
