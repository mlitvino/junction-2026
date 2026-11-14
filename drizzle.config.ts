import { defineConfig } from "drizzle-kit";

// drizzle-kit: `pnpm db:generate` turns schema changes into SQL migrations in drizzle/ (commit them).
// Migrations are applied by ensureDatabase() (src/server/db/migrate.ts) or `pnpm db:migrate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app" },
  // Mastra creates and owns its own tables.
  tablesFilter: ["!mastra_*"],
  strict: true,
  verbose: true,
});
