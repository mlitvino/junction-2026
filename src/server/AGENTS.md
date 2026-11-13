# Backend zone

**Owner:** Backend/infra dev.

Backend zone. Do not touch the frontend folders. Change `shared/contracts` only when both developers have agreed.

Every file here starts with `import "server-only";`. See the root AGENTS.md for ownership and the boundary rules.

## Agents and database

- Mastra instance: `getMastra()` in `server/mastra.ts` (lazy; Postgres storage). Agents live in `server/agents/`, tools in `server/agents/tools/`. Use `createTool()` with a Zod `inputSchema`; plain objects don't work.
- Postgres pool: `getPool()` in `server/db/pool.ts`. Reads `DATABASE_URL`; never import it from frontend code.
- The purchasing agent currently runs on a **mock model** (fixed answer, no API key). To use a real model, change `model` in `purchasing-agent.ts` to a `"provider/model"` string and set that provider's key in `.env.local`.
- To expose an agent to the frontend: contract in `shared/contracts` (needs approval) → service in `server/services` → thin route in `app/api`.
