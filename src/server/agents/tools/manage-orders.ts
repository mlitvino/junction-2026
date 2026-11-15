import "server-only";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  actorFor,
  getProposal,
  placeOrder,
  verifyProposal,
} from "@/server/services/purchasing";
import { createProposalFromPrompt, reviseProposalFromRequest } from "@/server/services/selection";
import {
  OrderSchema,
  ProposalFromPromptResponseSchema,
  ProposalSchema,
  ProposalVerificationSchema,
  ReviseProposalRequestSchema,
  ReviseProposalResponseSchema,
} from "@/shared/contracts/purchasing";

import { toolActor } from "./actor";

// Purchasing tools. The agent acts for the signed-in buyer through the same flow as a person:
// it creates and revises proposals, and can order only what the organization's rules allow or an
// approver approved. It has no tool to approve.

const agentActor = (context: Parameters<typeof toolActor>[0]) => actorFor(toolActor(context), true);

export const createProposalTool = createTool({
  id: "create-proposal",
  description:
    "Turn a buyer's request into a proposal: extract items, pick products that fit the organization's dietary and allergen rules (preferring past orders), then price them, check availability and run the organization's policy. Returns the proposal, how each product was chosen, and what to do next.",
  inputSchema: z.object({
    prompt: z.string().describe("The buyer's request, e.g. '100 litres of lactose-free milk for Friday'."),
    date: z.string().optional().describe("Delivery date the goods are needed, YYYY-MM-DD."),
    autoResolvePartialStock: z.boolean().optional().describe("Split a line over alternatives when stock is short."),
  }),
  outputSchema: ProposalFromPromptResponseSchema,
  execute: async (input, context) => createProposalFromPrompt(agentActor(context), input),
});

export const reviseProposalTool = createTool({
  id: "revise-proposal",
  description:
    "Change a proposal (swap products, change quantities, remove or add lines, move the date). Creates a new, re-priced and re-checked proposal and cancels the old one; if the new one is BLOCKED by policy, the old one stays usable (previousCancelled: false).",
  inputSchema: ReviseProposalRequestSchema.extend({
    proposalId: z.string().describe("The proposal to change."),
  }),
  outputSchema: ReviseProposalResponseSchema,
  execute: async ({ proposalId, ...changes }, context) =>
    reviseProposalFromRequest(agentActor(context), proposalId, changes),
});

export const placeOrderTool = createTool({
  id: "place-order",
  description:
    "Order a proposal. Works only when the organization's rules allow it (decision ALLOW) or an approver has approved it; the server re-checks prices first. Repeating it for the same proposal returns the same order.",
  inputSchema: z.object({ proposalId: z.string().describe("The proposal to order.") }),
  outputSchema: OrderSchema,
  execute: async ({ proposalId }, context) =>
    (await placeOrder(agentActor(context), proposalId, `agent-${proposalId}`)).order,
});

export const getProposalTool = createTool({
  id: "get-proposal",
  description: "Read a proposal: lines, prices, availability, policy decision with reasons, approval and order status.",
  inputSchema: z.object({ proposalId: z.string() }),
  outputSchema: ProposalSchema,
  execute: async ({ proposalId }, context) => getProposal(agentActor(context), proposalId),
});

export const verifyProposalTool = createTool({
  id: "verify-proposal",
  description:
    "Check that a proposal's content still matches its SHA-256 hash and that each frozen price matches a recorded Valio price.",
  inputSchema: z.object({ proposalId: z.string() }),
  outputSchema: ProposalVerificationSchema,
  execute: async ({ proposalId }, context) => verifyProposal(agentActor(context), proposalId),
});
