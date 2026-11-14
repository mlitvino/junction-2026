import "server-only";

import type { MastraModelConfig } from "@mastra/core/llm";

export const GEMINI_MODEL = "google/gemini-3.8-flash";

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
 * Ensures `GOOGLE_GENERATIVE_AI_API_KEY` is configured whenever `TEST_MODE` is not `TRUE`.
 * Checked at execution time so module imports during builds and tests remain safe.
 */
export function requireGeminiApiKey(): void {
  if (!isAgentTestMode() && !hasGeminiApiKey()) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Configure it in .env, or set TEST_MODE=TRUE to use the deterministic flow.",
    );
  }
}

/** Resolves the Mastra model dynamically per agent run (mock in TEST_MODE=TRUE, Gemini otherwise). */
export function resolveAgentModel(mockModel: MastraModelConfig): MastraModelConfig {
  if (isAgentTestMode()) return mockModel;
  requireGeminiApiKey();
  return GEMINI_MODEL;
}
