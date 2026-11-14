// No `import "server-only"` here: drizzle-kit loads the schema outside Next.js, where it throws.
// Table definitions only, no secrets.
// The whole database schema (Drizzle). drizzle-kit reads it to generate migrations into drizzle/.
// Mastra's own tables (mastra_*) are not here: Mastra manages them itself.
export * from "./auth.ts";
export * from "./catalog.ts";
export * from "./organization.ts";
export * from "./procurement.ts";
export * from "./preferences.ts";
export * from "./purchasing.ts";
