import "server-only";

import { swaggerUI } from "@hono/swagger-ui";
import { HTTPException } from "hono/http-exception";

import { getAuth } from "@/server/auth/auth";
import { ensureAuthSchema } from "@/server/auth/migrate";

import { createRouter } from "./router";
import { extractRouter } from "./routes/extract/extract";
import { healthRouter } from "./routes/health/health";
import { meRouter } from "./routes/me/me";
import { ordersRouter } from "./routes/orders/orders";
import { organizationRouter } from "./routes/organization/organization";

/**
 * The whole /api surface. Mounted by src/app/api/[[...route]]/route.ts.
 * Add an endpoint: create ./routes/<name>/<name>.ts (+ <name>.docs.ts) and register it below.
 * The API is open by default; a route that needs the signed-in user adds `requireSession`
 * from ./middleware/session.ts (see ./routes/me/me.ts).
 */
export const app = createRouter().basePath("/api");

// Better Auth: sign-up, sign-in, sign-out, session, its own OpenAPI reference (/api/auth/reference).
app.on(["GET", "POST"], "/auth/*", async (c) => {
  await ensureAuthSchema();
  return getAuth().handler(c.req.raw);
});

app.route("/", healthRouter);
app.route("/", meRouter);
app.route("/", extractRouter);
app.route("/", ordersRouter);
app.route("/", organizationRouter);

// Public contract: OpenAPI spec + Swagger UI.
app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "better-auth.session_token",
  description:
    "Session cookie set by Better Auth on sign-in (named `__Secure-better-auth.session_token` over HTTPS).",
});
app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Trusted Trade Agents API",
    version: "0.1.0",
    description:
      "Interface for external purchasing agents to Valio Aimo (mock backend). " +
      "Sign-up, sign-in and sign-out are documented separately at /api/auth/reference.",
  },
});
app.get("/docs", swaggerUI({ url: "/api/openapi.json" }));

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
