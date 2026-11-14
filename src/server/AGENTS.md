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

## Agents and database

- Mastra instance: `getMastra()` in `server/mastra.ts` (lazy; Postgres storage). Agents live in `server/agents/`, tools in `server/agents/tools/`. Use `createTool()` with a Zod `inputSchema`; plain objects don't work.
- Postgres pool: `getPool()` in `server/db/pool.ts`. Reads `DATABASE_URL`; never import it from frontend code.
- The purchasing agent runs on **Gemini** (`google/gemini-3.8-flash`) when `GOOGLE_GENERATIVE_AI_API_KEY` is set, and on a **mock model** (fixed answer) when it isn't, so CI, builds and frontend work need no key. Mastra reads the key from the environment itself; never pass it in code.
- To expose an agent to the frontend: contract in `shared/contracts` (needs approval) → service in `server/services` → route folder in `server/api/routes/<name>/`.
