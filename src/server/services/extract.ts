import "server-only";

import { extractorAgent } from "@/server/agents/extractor-agent";
import { assertGeminiConfigured } from "@/server/agents/gemini";
import { getMastra } from "@/server/mastra";
import {
  type ExtractRequest,
  type ExtractResponse,
  ExtractResponseSchema,
} from "@/shared/contracts/extract";

/** Parses any free-form user prompt into JSON items (`productName`, `productType`, `productQuantity`) via Gemini. */
export async function extractProductsFromPrompt(input: ExtractRequest): Promise<ExtractResponse> {
  assertGeminiConfigured();

  const agent = process.env.DATABASE_URL
    ? getMastra().getAgentById("extractor-agent")
    : extractorAgent;

  const result = await agent.generate(input.prompt, {
    structuredOutput: { schema: ExtractResponseSchema },
  });

  return ExtractResponseSchema.parse(result.object);
}
