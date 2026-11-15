import "server-only";

import { swaggerUI } from "@hono/swagger-ui";
import { HTTPException } from "hono/http-exception";

import { AgentError } from "@/server/agents/mode";
import { ValioApiError } from "@/server/valio/client";
import { getAuth } from "@/server/auth/auth";
import { ensureDatabase } from "@/server/db/migrate";

import { requireSession } from "./middleware/session";
import { createRouter } from "./router";
import { agentRouter } from "./routes/agent/agent";
import { approvalsRouter } from "./routes/approvals/approvals";
import { auditRouter } from "./routes/audit/audit";
import { extractRouter } from "./routes/extract/extract";
import { healthRouter } from "./routes/health/health";
import { inquiriesRouter } from "./routes/inquiries/inquiries";
import { intelligenceRouter } from "./routes/intelligence/intelligence";
import { inventoryRouter } from "./routes/inventory/inventory";
import { meRouter } from "./routes/me/me";
import { ordersRouter } from "./routes/orders/orders";
import { organizationRouter } from "./routes/organization/organization";
import { policyRouter } from "./routes/policy/policy";
import { preferencesRouter } from "./routes/preferences/preferences";
import { productsRouter } from "./routes/products/products";
import { proposalsRouter } from "./routes/proposals/proposals";
import { recipesRouter } from "./routes/recipes/recipes";
import { trustRouter } from "./routes/trust/trust";

/**
 * The whole /api surface. Mounted by src/app/api/[[...route]]/route.ts.
 * Add an endpoint: create ./routes/<name>/<name>.ts (+ <name>.docs.ts) and register it below.
 * Default-deny: everything except /health, /trust/public-key, /docs, /openapi.json and /auth/* needs a session
 * (middleware below); routers add `requireRole(...)` from ./middleware/session.ts for their role.
 */
export const app = createRouter().basePath("/api");

// Default-deny: every /api route needs a signed-in user, except the public ones below. Routers
// still add `requireRole(...)` for the role they need; it reuses the user resolved here.
const PUBLIC_PATHS = new Set(["/api/health", "/api/trust/public-key", "/api/docs", "/api/openapi.json"]);
app.use("*", async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path) || c.req.path.startsWith("/api/auth/")) return next();
  return requireSession(c, next);
});

// Better Auth: sign-up, sign-in, sign-out, session, its own OpenAPI reference (/api/auth/reference).
app.on(["GET", "POST"], "/auth/*", async (c) => {
  await ensureDatabase();
  return getAuth().handler(c.req.raw);
});

app.route("/", healthRouter);
app.route("/", trustRouter);
app.route("/", meRouter);
app.route("/", organizationRouter);
app.route("/", preferencesRouter);
app.route("/", productsRouter);
app.route("/", policyRouter);
app.route("/", proposalsRouter);
app.route("/", approvalsRouter);
app.route("/", ordersRouter);
app.route("/", auditRouter);
app.route("/", inquiriesRouter);
app.route("/", inventoryRouter);
app.route("/", recipesRouter);
app.route("/", intelligenceRouter);
app.route("/", extractRouter);
app.route("/", agentRouter);

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
      "Sign-up, sign-in and sign-out are provided by Better Auth and documented separately: " +
      "[/api/auth/reference](/api/auth/reference). " +
      "Sign in there first; the session cookie it sets is what the endpoints marked with a lock need.",
  },
  // Swagger UI shows tags in this order. Without the list it uses the order of first use (router
  // registration below), which put Agents last; this keeps that order with Agents moved to the top.
  // Every tag used by a route should be listed here; the API surface test checks it.
  tags: [
    { name: "Agents", description: "The purchasing agent and prompt extraction (Gemini, or deterministic with TEST_MODE=TRUE)." },
    { name: "System", description: "Health and the proposal-signing public key." },
    { name: "Auth", description: "The signed-in user. Sign-up and sign-in: /api/auth/reference." },
    { name: "Organization", description: "Members and roles." },
    { name: "Preferences", description: "The organization's settings for the agent and approvals." },
    { name: "Catalog", description: "Product search, details, ranking, substitutes, prices and availability." },
    { name: "Policy", description: "The organization's rules applied to a draft order." },
    { name: "Purchasing", description: "Proposals, approvals, orders, receipts and verification." },
    { name: "Audit", description: "The organization's audit log." },
    { name: "Inquiries", description: "Price and availability inquiries." },
    { name: "Inventory", description: "Kitchen stock." },
    { name: "Recipes", description: "Recipes and recipe-to-proposal planning." },
    { name: "Intelligence", description: "Stock-out alerts, recurring-order checks and recommendations." },
  ],
});
// Categories start collapsed; click one to open it.
app.get("/docs", swaggerUI({ url: "/api/openapi.json", docExpansion: "none" }));

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  // Agent not configured (503) or the model call failed (502): say so, log the cause, hide details.
  if (err instanceof AgentError) {
    if (err.status === 502) console.error(err.message, err.cause);
    return c.json({ error: err.message, code: err.code }, err.status);
  }
  // Valio unreachable or failing, wherever it surfaced (e.g. inside the agent): say so, hide details.
  if (err instanceof ValioApiError) {
    console.error("Valio request failed", err.status, err.message);
    return c.json({ error: "Valio is unavailable. Try again in a moment.", code: "VALIO_UNAVAILABLE" }, 502);
  }
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
