import { z } from "zod";

import { ProposalSchema } from "./purchasing";

/** Single tool invocation trace recorded during an autonomous agent run */
export const AgentToolCallTraceSchema = z.object({
  toolName: z.string().meta({ example: "createProcurementOrder" }),
  args: z.record(z.string(), z.unknown()),
  summary: z.string().meta({
    example: "Created order ORD-8A7B6C5D (confirmed, 2268.00 EUR).",
  }),
});

export type AgentToolCallTrace = z.infer<typeof AgentToolCallTraceSchema>;

/** POST /api/agent/run — request body */
export const AgentRunRequestSchema = z.object({
  message: z.string().trim().min(1).meta({
    description:
      "Natural-language instruction to the purchasing agent (search, inquire, buy, change a proposal, check status, or order an allowed/approved proposal).",
    example: "I want 440 kg of creamy cheese delivered tomorrow",
  }),
  proposalId: z.string().trim().min(1).optional().meta({
    description: "The proposal being discussed, when following up (change it, verify it, order it).",
  }),
  deliveryDate: z.iso.date().optional().meta({
    description: "Optional target delivery date (YYYY-MM-DD).",
    example: "2026-11-16",
  }),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

/** POST /api/agent/run — response body */
export const AgentRunResponseSchema = z.object({
  reply: z.string().meta({
    description: "Human-readable response from the purchasing agent.",
  }),
  mode: z.enum(["gemini", "deterministic"]).meta({
    description:
      "'gemini' when executed via Mastra + Gemini LLM tools, 'deterministic' when running without GOOGLE_GENERATIVE_AI_API_KEY.",
  }),
  toolCalls: z.array(AgentToolCallTraceSchema).meta({
    description: "Ordered trace of tools invoked by the agent during this turn.",
  }),
  activeProposal: ProposalSchema.nullable().meta({
    description: "The proposal created, revised, ordered or inspected during this turn, if any.",
  }),
});

export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;
