# junction-2026

TODO: 1–2 sentences about what the app does.

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
