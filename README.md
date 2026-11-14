# junction-2026

Trusted Trade Agents (Junction 2026, Valio Aimo challenge): a prototype interface that lets an external purchasing agent look up products, prices and availability in a mock Valio Aimo backend, place an order within its permissions, or send it to a human for approval, and leave a readable audit trail of why.

## Requirements
- Node.js 20+ (developed on 24)
- pnpm 11 (`corepack enable`)

## Getting started
```bash
cp .env.example .env   # set BETTER_AUTH_SECRET (openssl rand -base64 32), VALIO_API_URL, VALIO_API_KEY
pnpm bootstrap         # install, start Postgres, download the Valio files (if missing), import them
pnpm dev               # starts Postgres (Docker) and the app
```
`pnpm bootstrap` is safe to rerun: it skips the download when `data/valio/` already has the files.
Open http://localhost:3000. You're sent to `/login`; create an account at `/signup` (login + password, min. 2 characters). The home page shows the status from `GET /api/health`. API docs: http://localhost:3000/api/docs (Swagger UI), spec: http://localhost:3000/api/openapi.json.

## Mocks (frontend without a backend)
Set this in `.env`:
```
NEXT_PUBLIC_USE_MOCKS=true
```
and run `pnpm dev:app` (no Docker needed). `src/client/api-client.ts` will then return data from `src/client/mocks/` instead of calling `/api/*`, and a Demo Buyer / Demo Approver selector in the account menu replaces sign-in. Mocks are checked against the same Zod contracts, so they can't drift from the real API.

**Connected mode** (the default, `pnpm dev`) is mixed: you sign in for real, and your username, organization and roles (buyer, approver) come from `GET /api/me`. Products, prices and availability in the demo scenarios are real (`GET /api/products/{id}`, `POST /api/offers`), and so is the decision (`POST /api/policy/evaluate`, from your organization's preferences; by default every order needs an approver). The agent, proposals, approvals and orders have no backend yet, so they run on the local simulator ("Real catalog prices · Simulated agent and orders"). Its data stays in your browser tab, per user: to try an approval end to end, use one account with both roles (every self-signed-up user has both).

## Database (Postgres + pgvector)

```bash
pnpm db:up   # local DB on 127.0.0.1:5432; pnpm dev runs this for you
```

`DATABASE_URL` in `.env` (see `.env.example`) points to it. Mastra creates its own tables on first use.

If the app fails with a migration error after pulling (e.g. `relation "approval" already exists`), your local database ran an older migration order: reset it with `pnpm db:reset && pnpm data:import` (deletes local data). Production is not affected.

## Valio catalog
```bash
pnpm data:fetch    # once: download the product, CO2 and reliability files
pnpm data:import   # load them into Postgres
```
Products land in the `valio_product*` tables. Live prices and availability are fetched server-side (for the purchasing agent) from Valio when `VALIO_API_KEY` is set, and from a deterministic mock otherwise; every answer is logged in `valio_price_snapshot` / `valio_availability_snapshot`.

## LLM (Gemini)
Put your Gemini API key in `.env` as `GOOGLE_GENERATIVE_AI_API_KEY` (see `.env.example`); the purchasing agent then uses `google/gemini-3.8-flash`. Without the key it falls back to a mock model, so nobody needs a key to run the app.

## Commands
| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the local Postgres, applies pending migrations, then the dev server (needs Docker) |
| `pnpm dev:app` | Dev server only, no Docker (frontend on mocks) |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint, including the zone boundary checks |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm check` | lint + typecheck. Run it before every commit |
| `pnpm test:server` | Backend unit tests (`src/server/**/*.test.ts`, plain Node) |
| `pnpm format` | Prettier |
| `pnpm db:up` / `db:down` | Start (waits until ready) / stop the local Postgres (`compose.dev.yml`) |
| `pnpm db:psql` | psql shell in the local DB |
| `pnpm db:reset` | Delete all local DB data and start fresh |
| `pnpm db:logs` | Follow the local Postgres logs |
| `pnpm db:generate` | Create a SQL migration from schema changes (`src/server/db/schema/` → `drizzle/`) |
| `pnpm db:migrate` | Apply pending migrations (the app also does it on first use) |
| `pnpm db:studio` | Browse the database in Drizzle Studio |
| `pnpm bootstrap` | First-time setup: install, start Postgres, `data:fetch` (if files missing), `data:import` |
| `pnpm data:fetch` | Download the static Valio files into `data/valio/` |
| `pnpm data:import` | Load `data/valio/` into Postgres (run after `data:fetch`; safe to repeat) |
| `pnpm data:analyze` | Data-quality report and anomalies for the Valio files |
| `pnpm docker:build` | Build the production image locally (same `Dockerfile` as CI) |
| `pnpm docker:run` | Run that image on http://localhost:3000 |

## Project layout
Code is split into frontend, backend and shared zones, and ESLint enforces the boundaries between them. See [AGENTS.md](AGENTS.md) for ownership, the structure, the rules and how to add an endpoint.

## Working with AI agents
- [AGENTS.md](AGENTS.md) is the single source of rules for every agent. Each zone has its own `src/<zone>/AGENTS.md`.
- **Claude Code** reads the root `CLAUDE.md`, which imports the root and every zone `AGENTS.md` and adds Claude-only notes. There are no other `CLAUDE.md` files: edit the `AGENTS.md` files, and when you add a zone `AGENTS.md`, add its import to `CLAUDE.md`.
- **Codex** reads `AGENTS.md` directly. Start it at the repo root, and add one line to your personal `~/.codex/AGENTS.md` so it knows whose agent it is: `In junction-2026 I am the frontend dev.` Recommended: run it in the `workspace-write` sandbox with approval on request.
- Claude's guardrails (`.claude/settings.json`) don't apply to Codex. The shared gate is CI: every pull request and every deploy runs `pnpm check` and `pnpm build`.
