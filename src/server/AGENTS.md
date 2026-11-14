# Backend zone

**Owner:** Backend/infra dev.

Backend zone. Do not touch the frontend folders. Change `shared/contracts` only when both developers have agreed.

Every file here starts with `import "server-only";`. See the root AGENTS.md for ownership and the boundary rules.

## API (Hono)

- `server/api/app.ts` is the whole `/api` surface: registers routers, serves `/api/openapi.json` and `/api/docs`, JSON 404 and 500 (no stack traces).
- `server/api/router.ts`: `createRouter()` gives every router the same validation error shape, `400 { error: issues }`. Always create routers with it.
- One folder per area: `server/api/routes/<name>/`.
- `server/api/routes/<name>/<name>.docs.ts`: the OpenAPI `createRoute` definitions for one area (paths, summaries, descriptions, request/response docs). Keep all documentation here.
- `server/api/routes/<name>/<name>.ts`: the router for that area, `createRouter().openapi(route, handler)`; handlers only call `server/services`. Reference: `routes/health/`.

## Auth (Better Auth)

- `server/auth/auth.ts`: `getAuth()` (lazy), username plugin, sessions in Postgres via `getPool()`.
- `server/auth/migrate.ts`: `ensureAuthSchema()` creates Better Auth's tables on first use.
- `server/auth/session.ts`: `getSessionUser(headers)` for server code.
- `server/api/middleware/session.ts`: `requireSession`, opt-in per route (the API is open for now). Use it as `createRouter().use("/<path>", requireSession)`; then `c.var.user` is set. Never read `c.var.user` in a route without it.
- `requireRole(...roles)` (same file): session + at least one of the roles, else 401/403. Example: `router.use("/organization/*", requireRole("approver"))`.
- Organizations (our tables, not Better Auth's organization plugin): `organization`, `organization_member (organization_id, user_id UNIQUE, roles text[])`, created by `ensureOrganizationSchema()` (`server/auth/organization-schema.ts`). `getSessionUser()` adds `organization` + `roles` and, for a user without a membership (fresh self sign-up), creates their own organization with buyer + approver (`getOrCreateMembership` in `server/auth/roles.ts`).
- Member management: `server/services/organization.ts` (every function takes the caller's organization id), routes in `server/api/routes/organization/`. Accounts created by an approver get their membership right away, so they never get an organization of their own.

## Agents and database

- Mastra instance: `getMastra()` in `server/mastra.ts` (lazy; Postgres storage). Agents live in `server/agents/`, tools in `server/agents/tools/`. Use `createTool()` with a Zod `inputSchema`; plain objects don't work.
- Postgres pool: `getPool()` in `server/db/pool.ts`. Reads `DATABASE_URL`; never import it from frontend code.
- The purchasing agent runs on **Gemini** (`google/gemini-3.8-flash`) when `GOOGLE_GENERATIVE_AI_API_KEY` is set, and on a **mock model** (fixed answer) when it isn't, so CI, builds and frontend work need no key. Mastra reads the key from the environment itself; never pass it in code.
- To expose an agent to the frontend: contract in `shared/contracts` (needs approval) → service in `server/services` → route folder in `server/api/routes/<name>/`.

## Valio data

Two folders with different jobs:

- `server/catalog/`: **offline tooling** for the static files, run from `scripts/` only: parse (`valio-data.ts`), analyze (`analyze.ts`), find anomalies (`anomalies.ts`), import into Postgres (`import.ts`). Runtime server code (services, agents, API) never imports from here.
- `server/valio/`: **runtime** Valio integration: upstream API schemas, the client, and the normalized types the rest of the server uses.

| Layer | File | Describes |
| --- | --- | --- |
| Static files | `server/catalog/valio-data.ts` (`RawProduct`, `CatalogProduct`) | `data/valio/*` as downloaded, parsed and joined (import only) |
| Live Valio API | `server/valio/api-schemas.ts` | `/api/price`, `/api/availability` exactly as the spec (`docs/valio-aimo-openapi.json`) |
| Database | `server/db/catalog-schema.ts` | tables + row types |
| Normalized types | `server/valio/types.ts` | products, prices, availability as the server uses them (camelCase). No HTTP endpoint |

- Tables (created on first use by `ensureCatalogSchema()`, additive only): `valio_product`, `valio_product_unit`, `valio_product_substitute` (static, loaded by `pnpm data:import`), and insert-only `valio_price_snapshot` / `valio_availability_snapshot` (every live answer we fetched: the audit trail and a 5-minute cache).
- `server/valio/client.ts`: `fetchPrices` / `fetchAvailability`. Without `VALIO_API_KEY` it runs in **mock mode** (deterministic fake data, `source: "mock"`). Never call it for the whole catalog: Valio rate-limits; narrow down with the static data first.
- `server/services/catalog.ts`: search, product details, prices and availability (cache → Valio → snapshot). Not exposed over HTTP; call it from agent tools (`server/agents/tools/`).
- Data quality: `pnpm data:analyze` and `docs/valio-data-anomalies.md`. Trust `storageTempC` over `temperatureCondition`; CO2 is a group average.
- Files used by the Node scripts (`scripts/*.ts`) import each other with relative `.ts` paths, not `@/`: plain Node doesn't know the alias.
