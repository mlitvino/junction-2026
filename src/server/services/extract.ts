import "server-only";

import { extractorAgent } from "@/server/agents/extractor-agent";
import { callModel, isAgentTestMode, requireGeminiApiKey } from "@/server/agents/mode";
import { getMastra } from "@/server/mastra";
import {
  type ExtractedProductItem,
  type ExtractRequest,
  type ExtractResponse,
  ExtractResponseSchema,
} from "@/shared/contracts/extract";

const KNOWN_TYPE_KEYWORDS: Array<{ keyword: string; productType: string }> = [
  { keyword: "cheese", productType: "Cheese" },
  { keyword: "juusto", productType: "Cheese" },
  { keyword: "havarti", productType: "Cheese" },
  { keyword: "oltermanni", productType: "Cheese" },
  { keyword: "salmon", productType: "Fish" },
  { keyword: "lohi", productType: "Fish" },
  { keyword: "trout", productType: "Fish" },
  { keyword: "fish", productType: "Fish" },
  { keyword: "potatoes", productType: "Potato" },
  { keyword: "potato", productType: "Potato" },
  { keyword: "peruna", productType: "Potato" },
  { keyword: "leek", productType: "Vegetables" },
  { keyword: "carrots", productType: "Vegetables" },
  { keyword: "carrot", productType: "Vegetables" },
  { keyword: "vegetables", productType: "Vegetables" },
  { keyword: "vegetable", productType: "Vegetables" },
  { keyword: "dill", productType: "Herbs" },
  { keyword: "tilli", productType: "Herbs" },
  { keyword: "herbs", productType: "Herbs" },
  { keyword: "broth", productType: "Broth" },
  { keyword: "fond", productType: "Broth" },
  { keyword: "stock", productType: "Broth" },
  { keyword: "milk", productType: "Milk" },
  { keyword: "maito", productType: "Milk" },
  { keyword: "butter", productType: "Butter" },
  { keyword: "voi", productType: "Butter" },
  { keyword: "cream", productType: "Cream" },
  { keyword: "kerma", productType: "Cream" },
  { keyword: "yogurt", productType: "Yogurt" },
  { keyword: "yoghurt", productType: "Yogurt" },
  { keyword: "jogurtti", productType: "Yogurt" },
  { keyword: "quark", productType: "Yogurt" },
  { keyword: "rahka", productType: "Yogurt" },
];

function inferProductType(name: string): string {
  const lower = name.toLowerCase();
  // Match more specific keywords properly (e.g. "creamy cheese" -> "Cheese", not "Cream")
  for (const { keyword, productType } of KNOWN_TYPE_KEYWORDS) {
    const wordBoundary = new RegExp(`\\b${keyword}\\b`, "i");
    if (wordBoundary.test(lower)) return productType;
  }
  for (const { keyword, productType } of KNOWN_TYPE_KEYWORDS) {
    if (lower.includes(keyword)) return productType;
  }
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "Product";
  return last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
}

function capitalizeFirst(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Deterministic multi-item prompt parser used when TEST_MODE=TRUE,
 * allowing realistic multi-product and variable-quantity procurement tests in offline/CI environments.
 */
function extractDeterministically(prompt: string): ExtractedProductItem[] {
  const items: ExtractedProductItem[] = [];
  const clauses = prompt
    .split(/(?:(?<!\d),(?!\d)|;|\band\b|\bplus\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const qtyOfProductRegex =
    /(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml|st|ki|kpl|pcs|pieces?|packs?|cases?|boxes?|cartons?|units?|liters?|litres?|kilograms?)\s+(?:of\s+)?([a-zA-ZäöåÄÖÅ0-9\s%-]+?)(?:\s+(?:delivered|for|by|tomorrow|today|please)\b.*)?$/i;
  const dashFormatRegex =
    /^([a-zA-ZäöåÄÖÅ0-9\s%-]+?)\s+-\s+([a-zA-ZäöåÄÖÅ0-9\s%-]+?)\s+-\s+(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml|st|ki|kpl|pcs|pieces?|packs?|cases?|boxes?|cartons?|units?|liters?|litres?|kilograms?)$/i;
  const productThenQtyRegex =
    /^([a-zA-ZäöåÄÖÅ0-9\s%-]+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml|st|ki|kpl|pcs|pieces?|packs?|cases?|boxes?|cartons?|units?|liters?|litres?|kilograms?)(?:\s+(?:delivered|for|by|tomorrow|today|please)\b.*)?$/i;

  for (const clause of clauses) {
    const cleanedClause = clause
      .replace(
        /^(?:i\s+(?:want|need|would\s+like)(?:\s+to\s+(?:buy|order|get))?|please\s+(?:buy|order|get)|buy|order|get)\s+/i,
        "",
      )
      .trim();

    const dashMatch = dashFormatRegex.exec(cleanedClause);
    if (dashMatch) {
      const rawName = dashMatch[1]!.trim();
      const rawType = dashMatch[2]!.trim();
      const amount = dashMatch[3]!.replace(",", ".");
      const unit = dashMatch[4]!;
      if (rawName) {
        items.push({
          productName: capitalizeFirst(rawName),
          productType: capitalizeFirst(rawType) || inferProductType(rawName),
          productQuantity: `${amount} ${unit}`,
        });
        continue;
      }
    }

    const m = qtyOfProductRegex.exec(cleanedClause);
    if (m) {
      const amount = m[1]!.replace(",", ".");
      const unit = m[2]!;
      const rawName = m[3]!.trim();
      if (rawName) {
        items.push({
          productName: capitalizeFirst(rawName),
          productType: inferProductType(rawName),
          productQuantity: `${amount} ${unit}`,
        });
        continue;
      }
    }

    const trailingMatch = productThenQtyRegex.exec(cleanedClause);
    if (trailingMatch) {
      const rawName = trailingMatch[1]!.trim();
      const amount = trailingMatch[2]!.replace(",", ".");
      const unit = trailingMatch[3]!;
      if (rawName) {
        items.push({
          productName: capitalizeFirst(rawName),
          productType: inferProductType(rawName),
          productQuantity: `${amount} ${unit}`,
        });
      }
    }
  }

  return items;
}

export async function extractProductsFromPrompt(input: ExtractRequest): Promise<ExtractResponse> {
  if (isAgentTestMode()) {
    const parsed = extractDeterministically(input.prompt);
    if (parsed.length > 0) {
      return { items: parsed };
    }
  } else {
    requireGeminiApiKey();
  }

  const agent = process.env.DATABASE_URL
    ? getMastra().getAgentById("extractor-agent")
    : extractorAgent;

  return callModel(async () => {
    const result = await agent.generate(input.prompt, {
      structuredOutput: { schema: ExtractResponseSchema },
    });
    return ExtractResponseSchema.parse(result.object);
  });
}
