import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI, username } from "better-auth/plugins";

import { getDb } from "@/server/db/client";
import { account, session, user, verification } from "@/server/db/schema";

function requireEnv(name: "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

function createAuth() {
  return betterAuth({
    // Tables are defined in server/db/schema/auth.ts and migrated by Drizzle (drizzle/), not by Better Auth.
    database: drizzleAdapter(getDb(), { provider: "pg", schema: { user, session, account, verification } }),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    baseURL: requireEnv("BETTER_AUTH_URL"),
    // Login + password. Better Auth requires an email; the client sends a placeholder (see src/client/auth-client.ts).
    emailAndPassword: { enabled: true, minPasswordLength: 2 },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 30 }),
      // Documents Better Auth's own endpoints at /api/auth/reference.
      openAPI(),
    ],
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & { __auth?: Auth };

/** Lazy: importing this file must not need env or a database (e.g. during `next build`). */
export function getAuth(): Auth {
  globalForAuth.__auth ??= createAuth();
  return globalForAuth.__auth;
}
