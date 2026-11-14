import "server-only";

import { betterAuth } from "better-auth";
import { openAPI, username } from "better-auth/plugins";

import { getPool } from "@/server/db/pool";

function requireEnv(name: "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

function createAuth() {
  return betterAuth({
    database: getPool(),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    baseURL: requireEnv("BETTER_AUTH_URL"),
    // Login + password. Better Auth requires an email; the client sends a placeholder (see src/client/auth-client.ts).
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
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
