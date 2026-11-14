import "server-only";

import type { MastraModelConfig } from "@mastra/core/llm";

export const GEMINI_MODEL = "google/gemini-3.8-flash";

/**
 * Agent failures the API reports as such instead of a plain 500 (mapped in server/api/app.ts):
 * - 503 `AGENT_NOT_CONFIGURED`: no Gemini key and not in TEST_MODE (server configuration).
 */
export class AgentError extends Error {
  readonly status: 502 | 503;
  readonly code: "AGENT_NOT_CONFIGURED" | "MODEL_FAILED";
  constructor(status: 502 | 503, code: AgentError["code"], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Deterministic fallback flows and mock models are enabled only when `TEST_MODE=TRUE`
 * (case-insensitive). Outside test mode, live Gemini via `GOOGLE_GENERATIVE_AI_API_KEY` is required.
 */
export function isAgentTestMode(): boolean {
  return process.env.TEST_MODE?.trim().toLowerCase() === "true";
}

/** True when a non-empty Gemini API key is present in the environment. */
export function hasGeminiApiKey(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
}

/**
 * Ensures `GOOGLE_GENERATIVE_AI_API_KEY` is configured whenever `TEST_MODE` is not `TRUE`
 * (else a 503 `AGENT_NOT_CONFIGURED`). Checked at execution time so module imports during builds
 * and tests remain safe.
 */
export function requireGeminiApiKey(): void {
  if (!isAgentTestMode() && !hasGeminiApiKey()) {
    throw new AgentError(
      503,
      "AGENT_NOT_CONFIGURED",
      "The agent is not configured: GOOGLE_GENERATIVE_AI_API_KEY is not set on the server (or set TEST_MODE=TRUE for the deterministic flow).",
    );
  }
}

/** Resolves the Mastra model dynamically per agent run (mock in TEST_MODE=TRUE, Gemini otherwise). */
export function resolveAgentModel(mockModel: MastraModelConfig): MastraModelConfig {
  if (isAgentTestMode()) return mockModel;
  requireGeminiApiKey();
  return GEMINI_MODEL;
}

