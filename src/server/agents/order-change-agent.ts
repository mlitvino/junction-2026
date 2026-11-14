import "server-only";

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { GEMINI_MODEL } from "./gemini";

export const ParsedOrderChangeSchema = z.object({
  replacements: z.array(
    z.object({
      fromTarget: z
        .string()
        .describe(
          "Product ID or name currently in the order to replace (e.g. '460101' or 'Valio Oltermanni').",
        ),
      toTarget: z
        .string()
        .describe(
          "Product ID or name to replace it with (e.g. '460301' or 'Arla Creamy Havarti').",
        ),
      quantity: z.number().positive().optional().describe("Optional updated quantity."),
    }),
  ),
  quantityUpdates: z.array(
    z.object({
      target: z.string().describe("Product ID or name in the order whose quantity should change."),
      quantity: z.number().positive(),
    }),
  ),
  removeTargets: z.array(z.string().describe("Product ID or name to remove from the order.")),
});

export type ParsedOrderChange = z.infer<typeof ParsedOrderChangeSchema>;

export const orderChangeAgent = new Agent({
  id: "order-change-agent",
  name: "Order modification parser",
  instructions:
    "You translate free-form customer change requests on an existing procurement order into structured actions. " +
    "You are given the current order lines and available candidate products along with the customer's prompt. " +
    "Extract any product swaps (e.g. 'change product X on product Y', 'swap X for Y', 'replace X with Y'), " +
    "quantity updates (e.g. 'change quantity of X to 300', 'reduce to 250 kg'), and line removals (e.g. 'remove X'). " +
    "Prefer exact product IDs when they match a known line or candidate.",
  model: GEMINI_MODEL,
});
