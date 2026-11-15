import "server-only";

import { Agent } from "@mastra/core/agent";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { z } from "zod";

import { isAgentTestMode, resolveAgentModel } from "./mode";

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
  name: isAgentTestMode() ? "Order modification parser (test)" : "Order modification parser",
  instructions:
    "You translate free-form customer change requests on an existing procurement order into structured actions. " +
    "You are given the current order lines and available candidate products along with the customer's prompt. " +
    "Extract any product swaps (e.g. 'change product X on product Y', 'swap X for Y', 'replace X with Y'), " +
    "quantity updates (e.g. 'change quantity of X to 300', 'reduce to 250 kg'), and line removals (e.g. 'remove X'). " +
    "Prefer exact product IDs when they match a known line or candidate.",
  model: () => resolveAgentModel(mockModel),
});

export type KnownOrderLine = {
  productId?: string;
  name: string;
  requestedName?: string;
};

function stripOuterQuotes(s: string): string {
  const trimmed = s.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSwapBody(
  body: string,
  knownLines?: readonly KnownOrderLine[],
): { fromTarget: string; rawTo: string } | null {
  if (knownLines && knownLines.length > 0) {
    const candidates = [
      ...new Set(
        knownLines
          .flatMap((l) => [l.name, l.productId ?? "", l.requestedName ?? ""])
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => b.length - a.length);

    for (const cand of candidates) {
      const re = new RegExp(
        `^["']?(${escapeRegExp(cand)})["']?\\s+(?:to|with|into|for|on)\\s+(?:product\\s+)?(.+)$`,
        "i",
      );
      const m = re.exec(body);
      if (m) {
        return { fromTarget: m[1]!.trim(), rawTo: m[2]!.trim() };
      }
    }
  }

  // Prefer "to" / "with" / "into" before falling back to "for" / "on"
  // so product names containing "for" (e.g. "butter for laminating") do not split prematurely.
  const preferred = /^["']?(.+?)["']?\s+(?:to|with|into)\s+(?:product\s+)?(.+)$/i.exec(body);
  if (preferred) {
    return { fromTarget: stripOuterQuotes(preferred[1]!), rawTo: preferred[2]!.trim() };
  }

  const fallback = /^["']?(.+?)["']?\s+(?:for|on)\s+(?:product\s+)?(.+)$/i.exec(body);
  if (fallback) {
    return { fromTarget: stripOuterQuotes(fallback[1]!), rawTo: fallback[2]!.trim() };
  }

  return null;
}

/**
 * Deterministic fallback parser for natural-language order change prompts when TEST_MODE=TRUE.
 */
export function parseOrderChangeDeterministically(
  prompt: string,
  knownLines?: readonly KnownOrderLine[],
): ParsedOrderChange {
  const replacements: ParsedOrderChange["replacements"] = [];
  const quantityUpdates: ParsedOrderChange["quantityUpdates"] = [];
  const removeTargets: string[] = [];

  const cleaned = prompt.trim();
  if (!cleaned) return { replacements, quantityUpdates, removeTargets };

  // Split into clauses on semicolons, non-decimal periods, or commas before a command verb.
  const clauses = cleaned
    .split(/\s*(?:;|(?<!\d)\.(?=\s|$)|,\s+(?=(?:please\s+)?(?:change|swap|replace|switch|remove|delete|drop|set|update|reduce|increase)\b))\s*/i)
    .map((c) => c.replace(/[.;]+$/, "").trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const swapMatch = /^(?:please\s+)?(?:change|swap|replace|switch)\s+(?:product\s+)?(.+)$/i.exec(clause);
    if (swapMatch) {
      const body = swapMatch[1]!.trim();

      // Avoid misclassifying "change quantity of X to 300" as a product swap
      if (/^(?:the\s+)?(?:quantity|amount|volume)\b/i.test(body)) {
        const qtyBody =
          /^(?:the\s+)?(?:quantity|amount|volume)\s+(?:of|for)\s+["']?(.+?)["']?\s+to\s+(\d+(?:[.,]\d+)?)\s*(?:kg|l|st|ki|units?)?$/i.exec(
            body,
          );
        if (qtyBody) {
          const parsedNum = Number.parseFloat(qtyBody[2]!.replace(",", "."));
          if (Number.isFinite(parsedNum) && parsedNum > 0) {
            quantityUpdates.push({
              target: stripOuterQuotes(qtyBody[1]!),
              quantity: parsedNum,
            });
          }
        }
        continue;
      }

      const split = splitSwapBody(body, knownLines);
      if (split) {
        let toTarget = split.rawTo.replace(/[.;]+$/, "").trim();
        let qty: number | undefined;

        const trailingQty =
          /^(.+?)\s+(?:and\s+)?(?:with\s+|at\s+|set\s+quantity\s+to\s+|quantity\s+|qty\s+)(\d+(?:[.,]\d+)?)\s*(?:kg|l|st|ki|units?)?$/i.exec(
            toTarget,
          );
        if (trailingQty) {
          toTarget = trailingQty[1]!.trim();
          qty = Number.parseFloat(trailingQty[2]!.replace(",", "."));
        }

        toTarget = stripOuterQuotes(toTarget);
        if (split.fromTarget && toTarget) {
          replacements.push({
            fromTarget: split.fromTarget,
            toTarget,
            quantity: qty && Number.isFinite(qty) && qty > 0 ? qty : undefined,
          });
          continue;
        }
      }
    }

    // Pattern 2: "set/update/change quantity [of X] to N" or "reduce/increase [X] to N"
    const qtyMatch =
      /^(?:please\s+)?(?:set|update|change|reduce|increase)\s+(?:the\s+)?(?:quantity|amount)?\s*(?:of|for)?\s*["']?(.*?)["']?\s+to\s+(\d+(?:[.,]\d+)?)\s*(?:kg|l|st|ki|units?)?$/i.exec(
        clause,
      );
    if (qtyMatch) {
      const rawTarget = stripOuterQuotes(qtyMatch[1]!);
      const num = Number.parseFloat(qtyMatch[2]!.replace(",", "."));
      if (Number.isFinite(num) && num > 0) {
        quantityUpdates.push({
          target: rawTarget || "*",
          quantity: num,
        });
      }
      continue;
    }

    // Pattern 3: "remove/delete [product] X"
    const removeMatch = /^(?:please\s+)?(?:remove|delete|drop)\s+(?:product\s+)?["']?(.+?)["']?$/i.exec(clause);
    if (removeMatch) {
      const target = stripOuterQuotes(removeMatch[1]!);
      if (target) removeTargets.push(target);
    }
  }

  return { replacements, quantityUpdates, removeTargets };
}
