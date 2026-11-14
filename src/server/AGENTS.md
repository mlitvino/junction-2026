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

- `server/auth/auth.ts`: `getAuth()` (lazy), username plugin, Drizzle adapter (tables in `server/db/schema/auth.ts`).
- `server/auth/session.ts`: `getSessionUser(headers)` for server code.
- `server/api/middleware/session.ts`: `requireSession` (run on every private route by the default-deny middleware in `app.ts`) and `requireRole(...roles)`; both reuse the user already resolved for the request. `getSessionUser` returns null without a session cookie before touching the database.
- `requireRole(...roles)` (same file): session + at least one of the roles, else 401/403. Example: `router.use("/organization/*", requireRole("approver"))`.
- Organizations (our tables, not Better Auth's organization plugin): `organization`, `organization_member (organization_id, user_id UNIQUE, roles text[])`, defined in `server/db/schema/organization.ts`. `getSessionUser()` adds `organization` + `roles` and, for a user without a membership (fresh self sign-up), creates their own organization with buyer + approver (`getOrCreateMembership` in `server/auth/roles.ts`).
- Member management: `server/services/organization.ts` (every function takes the caller's organization id), routes in `server/api/routes/organization/`. Accounts created by an approver get their membership right away, so they never get an organization of their own.

## Agents and database

- Mastra instance: `getMastra()` in `server/mastra.ts` (lazy; Postgres storage). Agents live in `server/agents/`, tools in `server/agents/tools/`. Use `createTool()` with a Zod `inputSchema`; plain objects don't work.
- Database: `getDb()` (Drizzle, `server/db/client.ts`) for all queries; call `ensureDatabase()` (`server/db/migrate.ts`) first, it applies pending migrations once per process. Schema in `server/db/schema/` (the only files here without `import "server-only"`: drizzle-kit loads them outside Next.js). `getPool()` (`server/db/pool.ts`) is the shared pg pool under Drizzle and Mastra; don't query through it directly.
- The purchasing agent runs on **Gemini** (`google/gemini-3.8-flash`) via `GOOGLE_GENERATIVE_AI_API_KEY`, and uses the deterministic flow / mock model only when `TEST_MODE=TRUE` (so CI and offline tests need no key). Mastra reads the key from the environment itself; never pass it in code.
- To expose an agent to the frontend: contract in `shared/contracts` (needs approval) → service in `server/services` → route folder in `server/api/routes/<name>/`.

## Preferences

Model, rules and endpoints: root AGENTS.md, "Preferences". Code: layers table `preference_layer` (`server/db/schema/preferences.ts`, sparse `settings` jsonb + `locked`), `server/services/preferences.ts` (`resolvePreferences` is pure; `updateLayer` runs in a transaction under a per-organization advisory lock and validates the effective sets of both roles), routes in `server/api/routes/preferences/`. To add a setting: add it to `PreferencesSchema` (shared contract, needs agreement) and `DEFAULT_PREFERENCES`; no migration needed (settings are JSON).

## Policy

The policy check applies preferences to a draft order. Rules: `server/policy/evaluate.ts` (pure, no DB; unit tests next to it, `pnpm test:server`). `server/services/policy.ts` (`evaluateDraft`) loads the buyer's effective preferences, product facts and server-side prices and availability for the requested date (`getPrices`, `getAvailability`) and calls it; route `POST /api/policy/evaluate` in `server/api/routes/policy/`. `createProposal` calls `evaluateDraft` and freezes the decision in the proposal; the endpoint itself stores nothing. Missing product data never triggers a rule (that is the agent's call).

## Purchasing flow

Services: `services/purchasing.ts` (proposals, approvals, orders, revise, receipt, verify; `actorFor(user, agent?)` builds the caller), `services/selection.ts` (the agent's product selection from a prompt or recipe needs, ending in `createProposal`; `customerPreferencesFor` turns the buyer's preferences into the candidate filter), `services/audit.ts` (`recordAudit` inside transactions, `auditChange` after a change, `listAudit`). Agent tools get the signed-in user from the Mastra request context (`agents/tools/actor.ts`) and never act anonymously.

Model and rules: root AGENTS.md, "Purchasing flow". Tables `proposal`, `approval`, `purchase_order` (`server/db/schema/purchasing.ts`; lines and decision as jsonb). Pure rules (hash, allowed transitions) in `server/purchasing/rules.ts` with tests; `server/services/purchasing.ts` applies them in transactions that lock the proposal row (`FOR UPDATE`), so parallel requests can't create two orders; the idempotency key is UNIQUE per organization. Routes: `server/api/routes/{proposals,approvals,orders}/`; `PurchasingError(status, code)` maps to the response. Proposal creation runs `evaluateDraft` (policy check, incl. availability), sets `quote_expires_at` (+24 h, `QUOTE_TTL_HOURS`) and signs id + hash (`server/purchasing/signing.ts`, pure Ed25519 with tests; key and public key in `services/trust.ts`, route `routes/trust/`). Approvals get `expires_at` = the quote expiry; `expireStaleApprovals` (start of list/get/decide/pending-count) marks overdue ones `EXPIRED` with `FOR UPDATE SKIP LOCKED` and a system audit event. `placeOrder` re-checks prices and availability (`checkLiveOffer`) with a Valio call made before the locked transaction, never inside it.

## Catalog data rules

- Real products only carry real data: no invented prices or stock (candidates without a Valio price are skipped). Nutrition (`nutritionFact`), labels (`packagingMarkedLabel`, storage temperatures removed), claims (`nutritionalClaim`, `nonAllergen` FREE_FROM), content per base unit (`unitConversions[].volume`) and dietary tags (from claims) are imported by `server/catalog/valio-data.ts`; label names in `shared/contracts/labels.ts`.
- Synthetic products (`services/mock-catalog.ts`) have `SYN-` ids and are used only when the real catalog is empty (`syntheticCatalogEnabled()`), together with demo history and demo kitchen stock.
- Allergens: GS1 codes in the data, imported with their qualifier: `allergens` = CONTAINS, `may_contain_allergens` = MAY_CONTAIN (UNDECLARED dropped). Names or codes in settings and filters, mapped by `shared/contracts/allergens.ts`. Policy: contains an excluded allergen → DENY, may contain → approval.

## Valio data

Two folders with different jobs:

- `server/catalog/`: **offline tooling** for the static files, run from `scripts/` only: parse (`valio-data.ts`), analyze (`analyze.ts`), find anomalies (`anomalies.ts`), import into Postgres (`import.ts`). Runtime server code (services, agents, API) never imports from here.
- `server/valio/`: **runtime** Valio integration: upstream API schemas, the client, and the normalized types the rest of the server uses.

| Layer | File | Describes |
| --- | --- | --- |
| Static files | `server/catalog/valio-data.ts` (`RawProduct`, `CatalogProduct`) | `data/valio/*` as downloaded, parsed and joined (import only) |
| Live Valio API | `server/valio/api-schemas.ts` | `/api/price`, `/api/availability` exactly as the spec (`docs/valio-aimo-openapi.json`) |
| Database | `server/db/schema/catalog.ts` | Drizzle tables; row types via `$inferSelect` |
| Normalized types | `shared/contracts/products.ts` | products, prices, availability as the server and the HTTP routes use them (camelCase) |

- Tables (Drizzle schema + migrations, additive only): `valio_product`, `valio_product_unit`, `valio_product_substitute` (static, loaded by `pnpm data:import`), and insert-only `valio_price_snapshot` / `valio_availability_snapshot` (every live answer we fetched: the audit trail and a 5-minute cache).
- `server/valio/client.ts`: `fetchPrices` / `fetchAvailability`. Without `VALIO_API_KEY` it runs in **mock mode** (deterministic fake data, `source: "mock"`). Never call it for the whole catalog: Valio rate-limits; narrow down with the static data first.
- `server/services/catalog.ts`: search with filters (all in SQL), product details, unit facts, prices and availability (cache → Valio → snapshot) and `getOffers`. Exposed as `GET /api/products`, `/api/products/{id}`, `/offer`, `POST /api/offers`, `POST /api/products/rank` (ranking in `server/purchasing/ranking.ts`, pure, with tests) and `POST /api/products/{id}/substitutes`. Unit conversion: `server/valio/units.ts` (pure, with tests). Agent tools call the services directly.
- Data quality: `pnpm data:analyze` and `docs/valio-data-anomalies.md`. Trust `storageTempC` over `temperatureCondition`; CO2 is a group average.
- Files used by the Node scripts (`scripts/*.ts`) import each other with relative `.ts` paths, not `@/`: plain Node doesn't know the alias.
