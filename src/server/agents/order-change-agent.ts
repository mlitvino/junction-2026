import "server-only";

import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { z } from "zod";

const GEMINI_MODEL = "google/gemini-3.8-flash";
const useGemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

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

const mockModel = createMockModel({
  mockText: {
    replacements: [],
    quantityUpdates: [],
    removeTargets: [],
  },
  version: "v2",
});

export const orderChangeAgent = new Agent({
  id: "order-change-agent",
  name: useGemini ? "Order modification parser" : "Order modification parser (mock)",
  instructions:
    "You translate free-form customer change requests on an existing procurement order into structured actions. " +
    "You are given the current order lines and available candidate products along with the customer's prompt. " +
    "Extract any product swaps (e.g. 'change product X on product Y', 'swap X for Y', 'replace X with Y'), " +
    "quantity updates (e.g. 'change quantity of X to 300', 'reduce to 250 kg'), and line removals (e.g. 'remove X'). " +
    "Prefer exact product IDs when they match a known line or candidate.",
  model: useGemini ? GEMINI_MODEL : mockModel,
});

/**
 * Deterministic fallback parser for natural-language order change prompts when GOOGLE_GENERATIVE_AI_API_KEY is unset.
 */
export function parseOrderChangeDeterministically(prompt: string): ParsedOrderChange {
  const replacements: ParsedOrderChange["replacements"] = [];
  const quantityUpdates: ParsedOrderChange["quantityUpdates"] = [];
  const removeTargets: string[] = [];

  const cleaned = prompt.trim();

  // Pattern 1: "change/swap/replace [product] X on/to/with/for [product] Y [and set quantity to N]"
  const swapRegex =
    /(?:change|swap|replace|switch)\s+(?:product\s+)?["']?([^"']+?)["']?\s+(?:on|to|with|for|into)\s+(?:product\s+)?["']?([^"',.;]+?)["']?(?:\s+(?:and\s+)?(?:with\s+|at\s+|set\s+quantity\s+to\s+|quantity\s+)(\d+(?:[.,]\d+)?))?(?:[.,;]|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = swapRegex.exec(cleaned)) !== null) {
    const fromTarget = match[1]!.trim();
    let toTarget = match[2]!.trim();
    let qty = match[3] ? Number.parseFloat(match[3].replace(",", ".")) : undefined;

    // Handle trailing quantity inside toTarget like "460301 300 kg" if explicit
    const trailingQty = /^(.+?)\s+(?:quantity|qty)\s+(\d+(?:[.,]\d+)?)/i.exec(toTarget);
    if (trailingQty) {
      toTarget = trailingQty[1]!.trim();
      qty = Number.parseFloat(trailingQty[2]!.replace(",", "."));
    }

    // Avoid misclassifying "change quantity of X to 300" as a product swap
    if (/^(?:the\s+)?(?:quantity|amount|volume)\b/i.test(fromTarget)) {
      const targetMatch = /(?:of|for)\s+(.+)$/i.exec(fromTarget);
      const parsedNum = Number.parseFloat(toTarget.replace(",", "."));
      if (targetMatch && Number.isFinite(parsedNum) && parsedNum > 0) {
        quantityUpdates.push({
          target: targetMatch[1]!.trim(),
          quantity: parsedNum,
        });
      }
      continue;
    }

    replacements.push({
      fromTarget,
      toTarget,
      quantity: qty && Number.isFinite(qty) && qty > 0 ? qty : undefined,
    });
  }

  // Pattern 2: "set/update/change quantity [of X] to N" or "reduce/increase [X] to N"
  const qtyRegex =
    /(?:set|update|change|reduce|increase)\s+(?:the\s+)?(?:quantity|amount)?\s*(?:of|for)?\s*["']?([^"']+?)["']?\s+to\s+(\d+(?:[.,]\d+)?)\s*(?:kg|l|st|ki|units?)?/gi;
  while ((match = qtyRegex.exec(cleaned)) !== null) {
    const rawTarget = match[1]!.trim();
    const num = Number.parseFloat(match[2]!.replace(",", "."));
    if (Number.isFinite(num) && num > 0) {
      // Skip if already captured as a product swap
      const isAlreadySwap = replacements.some(
        (r) => r.fromTarget.toLowerCase() === rawTarget.toLowerCase(),
      );
      if (!isAlreadySwap) {
        quantityUpdates.push({
          target: rawTarget || "*",
          quantity: num,
        });
      }
    }
  }

  // Pattern 3: "remove/delete [product] X"
  const removeRegex = /(?:remove|delete|drop)\s+(?:product\s+)?["']?([^"',.;]+?)["']?(?:[.,;]|$)/gi;
  while ((match = removeRegex.exec(cleaned)) !== null) {
    const target = match[1]!.trim();
    if (target) removeTargets.push(target);
  }

  return { replacements, quantityUpdates, removeTargets };
}
