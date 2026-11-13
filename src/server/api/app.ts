import "server-only";

import { swaggerUI } from "@hono/swagger-ui";
import { HTTPException } from "hono/http-exception";

import { createRouter } from "./router";
import { healthRouter } from "./routes/health";

/**
 * The whole /api surface. Mounted by src/app/api/[[...route]]/route.ts.
 * Add an endpoint: create a router in ./routes/<name>.ts and register it below.
 */
export const app = createRouter().basePath("/api");

app.route("/", healthRouter);

// Public contract: OpenAPI spec + Swagger UI.
app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Trusted Trade Agents API",
    version: "0.1.0",
    description: "Interface for external purchasing agents to Valio Aimo (mock backend).",
  },
});
app.get("/docs", swaggerUI({ url: "/api/openapi.json" }));

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
