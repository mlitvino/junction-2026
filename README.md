# junction-2026

Trusted Trade Agents (Junction 2026, Valio Aimo challenge): a prototype interface that lets an external purchasing agent look up products, prices and availability in a mock Valio Aimo backend, place an order within its permissions, or send it to a human for approval, and leave a readable audit trail of why.

## Requirements
- Node.js 20+ (developed on 24)
- pnpm 11 (`corepack enable`)

## Getting started
```bash
pnpm install
cp .env.example .env.local
pnpm dev
```
Open http://localhost:3000. The page shows the status from `GET /api/health`.

## Mocks (frontend without a backend)
Set this in `.env.local`:
```
NEXT_PUBLIC_USE_MOCKS=true
```
and restart `pnpm dev`. `src/client/api-client.ts` will then return data from `src/client/mocks/` instead of calling `/api/*`. Mocks are checked against the same Zod contracts, so they can't drift from the real API.

## Database (Postgres + pgvector)

```bash
docker compose -f compose.dev.yml up -d   # local DB on 127.0.0.1:5432
```

`DATABASE_URL` in `.env.local` (see `.env.example`) points to it. Mastra creates its own tables on first use. The agent currently uses a mock model, so no LLM API key is needed.

## Commands
| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint, including the zone boundary checks |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm check` | lint + typecheck. Run it before every commit |
| `pnpm format` | Prettier |

## Project layout
Code is split into frontend, backend and shared zones, and ESLint enforces the boundaries between them. See [AGENTS.md](AGENTS.md) for ownership, the structure, the rules and how to add an endpoint.

## Working with AI agents
- [AGENTS.md](AGENTS.md) is the single source of rules for every agent. Each zone has its own `src/<zone>/AGENTS.md`.
- **Claude Code** reads `CLAUDE.md`, which imports `AGENTS.md` and adds Claude-only notes. Every zone `CLAUDE.md` is a one-line import of the zone's `AGENTS.md`. Edit the `AGENTS.md` files, not the stubs.
- **Codex** reads `AGENTS.md` directly. Start it at the repo root, and add one line to your personal `~/.codex/AGENTS.md` so it knows whose agent it is: `In junction-2026 I am the frontend dev.` Recommended: run it in the `workspace-write` sandbox with approval on request.
- Claude's guardrails (`.claude/settings.json`) don't apply to Codex. The shared gate is CI: every pull request and every deploy runs `pnpm check` and `pnpm build`.
