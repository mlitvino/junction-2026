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
Code is split into frontend, backend and shared zones, and ESLint enforces the boundaries between them. See [CLAUDE.md](CLAUDE.md) for the structure, the rules and how to add an endpoint.
