import "server-only";

import { extractorAgent } from "@/server/agents/extractor-agent";
import { getMastra } from "@/server/mastra";
import {
  type ExtractRequest,
  type ExtractResponse,
  ExtractResponseSchema,
} from "@/shared/contracts/extract";

export async function extractProductsFromPrompt(input: ExtractRequest): Promise<ExtractResponse> {
  const agent = process.env.DATABASE_URL
    ? getMastra().getAgentById("extractor-agent")
    : extractorAgent;

  const result = await agent.generate(input.prompt, {
    structuredOutput: { schema: ExtractResponseSchema },
  });

  return ExtractResponseSchema.parse(result.object);
}
