<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# junction-2026

Trusted Trade Agents (Junction 2026, Valio Aimo challenge): a prototype interface that lets an external purchasing agent look up products, prices and availability in a mock Valio Aimo backend, place an order within its permissions, or send it to a human for approval, and leave a readable audit trail of why.

This file is the shared instruction set for every AI coding agent in this repo (Codex reads it directly, Claude Code imports it from `CLAUDE.md`). Keep tool-specific notes out of it.

## Ownership

Two developers, each working with their own AI agent. **Edit only the zone of the person you work for.** If the task needs a change in another zone (a new endpoint, a contract change, a dependency), stop and describe the change instead of making it. If you don't know whose agent you are, ask.

| Owner | Paths |
| --- | --- |
| Backend/infra dev | `src/server/`, `src/app/api/`, `src/proxy.ts`, `deploy/`, `.github/`, `.claude/`, `Dockerfile`, `compose.dev.yml`, `next.config.ts`, `package.json` dependencies |
| Frontend dev | `src/app/` (except `src/app/api/`), `src/components/`, `src/features/`, `src/client/` |
| Joint, by agreement only | `src/shared/contracts/` |

Before editing in a zone, read that zone's `AGENTS.md` (`src/<zone>/AGENTS.md`, also `src/app/api/AGENTS.md`).

## Stack (do not add or change without explicit approval)

- Next.js 16, **App Router only**, TypeScript strict, everything under `src/`
- Tailwind CSS v4 + shadcn/ui (`src/components/ui`, `cn()` in `src/components/lib/utils.ts`)
- Zod v4 for API contracts
- Hono + `@hono/zod-openapi` for every `/api` route; OpenAPI 3.1 spec at `/api/openapi.json`, Swagger UI at `/api/docs` (both public)
- Auth: Better Auth (login + password via its username plugin, sessions in Postgres), see "Auth" below
- AI agents: Mastra (`@mastra/core`, `@mastra/pg`), server-side only, in `src/server/agents/`. Listed in `serverExternalPackages` in `next.config.ts`.
- DB: Postgres + pgvector (`pgvector/pgvector:pg17`) via `pg`, connection from `DATABASE_URL`. Local: `pnpm db:up`. Migrations are additive only.
- ESLint (flat config, `eslint.config.mjs`) + Prettier
- pnpm
- **Forbidden:** Pages Router (`src/pages`), Server Actions (`"use server"`).

## Structure and zones

```
src/
  app/                    # FRONTEND: pages, layouts
    api/                  # BACKEND: thin route handlers only
  components/             # FRONTEND: UI components (shadcn in components/ui)
  features/               # FRONTEND: features (components + hooks per feature)
  client/                 # FRONTEND: api-client.ts + mocks/
  server/                 # BACKEND: business logic, db, agents, integrations
    services/
    db/
    agents/
  shared/                 # SHARED: contracts between frontend and backend
    contracts/            # Zod request/response schemas + inferred types
```

## Boundary rules (enforced by ESLint `no-restricted-imports`)

1. **Frontend** (`app/` except `app/api/`, `components/`, `features/`, `client/`) never imports from `src/server/`. It talks to the backend only through `src/client/` (`api-client.ts` for our API, `auth-client.ts` for sign-in/up/out and the session).
2. **Backend** (`app/api/`, `server/`) never imports from `components/`, `features/`, `client/`.
3. **Shared** (`shared/`) imports nothing from other zones. Only `zod` and plain types.
4. `src/app/api/[[...route]]/route.ts` only mounts the Hono app. Endpoints live in one folder per area, `src/server/api/routes/<name>/`, with two files: `<name>.docs.ts` (OpenAPI `createRoute` definitions using schemas from `shared/contracts`) and `<name>.ts` (router + handlers that call `server/services`). No logic in either.
5. Every file in `src/server/` starts with `import "server-only";`.
6. `api-client.ts` is typed by `shared/contracts` and serves data from `client/mocks/` when `NEXT_PUBLIC_USE_MOCKS=true`, so the frontend can work before the backend is ready.

Never disable these lint rules to make an import work. Move the code to the right zone, or put the shared type in `shared/contracts`.

## Adding an endpoint (reference: `GET /api/health`)

Step 1 is joint, steps 2–3 belong to the backend dev, steps 4–5 to the frontend dev.

1. `src/shared/contracts/<name>.ts`: request/response schemas + `z.infer` types. **Contract changes need explicit approval from both developers.**
2. `src/server/services/<name>.ts`: `import "server-only";` + plain functions with the logic.
3. A folder `src/server/api/routes/<name>/` with `<name>.docs.ts` + `<name>.ts`, then register the router in `src/server/api/app.ts` (`app.route("/", <name>Router)`). Never add files under `src/app/api/`. Example (see `routes/health/`):
   ```ts
   // routes/things/things.docs.ts: OpenAPI only
   export const createThingRoute = createRoute({
     method: "post", path: "/things", tags: ["Things"], summary: "Create a thing",
     request: { body: { content: { "application/json": { schema: CreateThingRequestSchema } } } },
     responses: { 200: { description: "Created", content: { "application/json": { schema: CreateThingResponseSchema } } } },
   });

   // routes/things/things.ts: router + handlers only
   export const thingsRouter = createRouter().openapi(createThingRoute, async (c) =>
     c.json(await createThing(c.req.valid("json")), 200),
   );
   ```
   Invalid input gets `400 { error: issues }` automatically, and the endpoint shows up in `/api/openapi.json` and `/api/docs`. Use `.meta({ description, example })` on contract fields to document them.
4. `src/client/mocks/<name>.ts` with a mock, plus a method on `apiClient` in `src/client/api-client.ts`.
5. UI in `src/features/<name>/`, calling `apiClient` only.

The frontend can build steps 4–5 against the mock as soon as step 1 is agreed, before steps 2–3 exist.

## Auth

- **API is open for now:** `/api` routes need no session by default. A route that needs the signed-in user adds `requireSession` (`src/server/api/middleware/session.ts`) to its router and reads `c.var.user`; reference: `routes/me/me.ts`. Plan: switch to default-deny before real data goes in.
- **Pages:** `src/proxy.ts` redirects to `/login` without a session cookie (cookie check only; the API checks sessions for real). `/login` and `/signup` are public. Skipped when `NEXT_PUBLIC_USE_MOCKS=true`.
- **Better Auth owns `/api/auth/*`** (sign-up, sign-in, sign-out, session), documented at `/api/auth/reference`. Their shapes are not in `shared/contracts`; the frontend uses `src/client/auth-client.ts`.
- Its tables (`user`, `session`, `account`, `verification`) are created on first use. Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.

## Secrets

- Never read, print or edit `.env*` files, except `.env.example`. Ask the developer for the value you need.
- Never put real secrets in code, mocks, `.env.example`, the Docker image or git. Use test keys with limits.

## Commands

- `pnpm dev`: dev server (http://localhost:3000)
- `pnpm build`: production build
- `pnpm lint`: ESLint
- `pnpm typecheck`: `tsc --noEmit`
- `pnpm check`: lint + typecheck
- `pnpm format`: Prettier
- `pnpm db:up` / `pnpm db:down` / `pnpm db:logs`: local Postgres from `compose.dev.yml`
- `pnpm docker:build` / `pnpm docker:run`: build and run the production image locally (http://localhost:3000)

**After any change, run `pnpm check` and fix every error before finishing.** CI runs `pnpm check` and `pnpm build` on every pull request and before every deploy.

## Deploy

Push to `main` → `.github/workflows/deploy.yml` runs the checks, builds the `Dockerfile` (Next.js `output: "standalone"`), pushes to ghcr.io and restarts the app on the Hetzner server over SSH. Server templates and rollback steps: `deploy/README.md`.

- The server's `.env` lives only on the server.
- DB migrations are additive only (new tables/columns, no drops), so a rollback to an older image keeps working.
