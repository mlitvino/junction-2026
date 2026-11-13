# junction-2026

TODO: 1–2 sentences about what the app does.

Team: one frontend dev and one backend dev, both working with AI agents in this repo. Stay in your zone.

@AGENTS.md

## Stack (do not add or change without explicit approval)

- Next.js 16, **App Router only**, TypeScript strict, everything under `src/`
- Tailwind CSS v4 + shadcn/ui (`src/components/ui`, `cn()` in `src/components/lib/utils.ts`)
- Zod v4 for API contracts
- AI agents: Mastra (`@mastra/core`, `@mastra/pg`), server-side only, in `src/server/agents/`. Listed in `serverExternalPackages` in `next.config.ts`.
- DB: Postgres + pgvector (`pgvector/pgvector:pg17`) via `pg`, connection from `DATABASE_URL`. Local: `docker compose -f compose.dev.yml up -d`. Migrations are additive only.
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
  server/                 # BACKEND: business logic, db, integrations
    services/
    db/
  shared/                 # SHARED: contracts between frontend and backend
    contracts/            # Zod request/response schemas + inferred types
```

## Boundary rules (enforced by ESLint `no-restricted-imports`)

1. **Frontend** (`app/` except `app/api/`, `components/`, `features/`, `client/`) never imports from `src/server/`. It talks to the backend only through `src/client/api-client.ts`.
2. **Backend** (`app/api/`, `server/`) never imports from `components/`, `features/`, `client/`.
3. **Shared** (`shared/`) imports nothing from other zones. Only `zod` and plain types.
4. Route handlers `app/api/**/route.ts` are thin: parse the input with a Zod schema from `shared/contracts`, call a function from `server/services`, return a response that matches the schema. No logic.
5. Every file in `src/server/` starts with `import "server-only";`.
6. `api-client.ts` is typed by `shared/contracts` and serves data from `client/mocks/` when `NEXT_PUBLIC_USE_MOCKS=true`, so the frontend can work before the backend is ready.

Never disable these lint rules to make an import work. Move the code to the right zone, or put the shared type in `shared/contracts`.

## Adding an endpoint (reference: `GET /api/health`)

1. `src/shared/contracts/<name>.ts`: request/response schemas + `z.infer` types. **Contract changes need explicit approval.**
2. `src/server/services/<name>.ts`: `import "server-only";` + plain functions with the logic.
3. `src/app/api/<name>/route.ts`: thin handler, for example:
   ```ts
   export async function POST(req: Request) {
     const parsed = CreateThingRequestSchema.safeParse(await req.json());
     if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
     return NextResponse.json(CreateThingResponseSchema.parse(await createThing(parsed.data)));
   }
   ```
4. `src/client/mocks/<name>.ts` with a mock, plus a method on `apiClient` in `src/client/api-client.ts`.
5. UI in `src/features/<name>/`, calling `apiClient` only.

## Security (enforced by `.claude/settings.json`, not by this file)

- `.env*` files (except `.env.example`), `~/.ssh` and `~/.aws` are off-limits: reads are denied, and `.claude/hooks/guard.sh` blocks Bash commands that mention `.env`.
- `sudo`, `curl`, `wget` and force-push are denied. `rm` and `git push` always ask.
- Bash runs in a sandbox: no writes outside the project, network only to the npm registry, GitHub and Google Fonts.
- bypassPermissions mode is disabled. Don't try to work around a block. Stop and tell the user what you needed and why.
- Never put real secrets in code, mocks or `.env.example`. Use test keys with limits.

## Commands

- `pnpm dev`: dev server (http://localhost:3000)
- `pnpm build`: production build
- `pnpm lint`: ESLint
- `pnpm typecheck`: `tsc --noEmit`
- `pnpm check`: lint + typecheck
- `pnpm format`: Prettier

**After any change, run `pnpm check` and fix every error before finishing.**

## Deploy

Push to `main` → `.github/workflows/deploy.yml` builds the `Dockerfile` (Next.js `output: "standalone"`), pushes to ghcr.io and restarts the app on the Hetzner server over SSH. Server templates and rollback steps: `deploy/README.md`.

- Never put secrets in the image or in git: the server's `.env` lives only on the server.
- DB migrations are additive only (new tables/columns, no drops), so a rollback to an older image keeps working.
