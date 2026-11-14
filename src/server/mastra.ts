import "server-only";
import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { extractorAgent } from "./agents/extractor-agent";
import { purchasingAgent } from "./agents/purchasing-agent";
import { getPool } from "./db/pool";

const globalForMastra = globalThis as typeof globalThis & { __mastra?: Mastra };

/**
 * The single Mastra instance (agents + Postgres storage).
 * Lazy: nothing connects to the database until the first call.
 * Use from `server/services` only, e.g. `getMastra().getAgentById("purchasing-agent")`.
 */
export function getMastra(): Mastra {
  globalForMastra.__mastra ??= new Mastra({
    agents: { purchasingAgent, extractorAgent },
    storage: new PostgresStore({ id: "pg-storage", pool: getPool() }),
  });
  return globalForMastra.__mastra;
}
