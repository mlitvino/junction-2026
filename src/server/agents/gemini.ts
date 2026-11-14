import "server-only";

export const GEMINI_MODEL = "google/gemini-3.8-flash";

/** Raised when an LLM-backed prompt parser or agent runs without GOOGLE_GENERATIVE_AI_API_KEY. */
export class MissingGeminiKeyError extends Error {
  constructor() {
    super(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Gemini is required to parse and route user prompts.",
    );
    this.name = "MissingGeminiKeyError";
  }
}

/** Ensures GOOGLE_GENERATIVE_AI_API_KEY is configured before calling Gemini. */
export function assertGeminiConfigured(): void {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new MissingGeminiKeyError();
  }
}
