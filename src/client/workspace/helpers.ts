import type { Proposal } from "@/shared/contracts/purchasing";
import type { ProductDetail } from "@/shared/contracts/products";
import type { Recipe } from "@/shared/contracts/recipes";
import type { InventoryItem } from "@/shared/contracts/inventory";
import type { Thread } from "./model";

export const REVISABLE_STATUSES = ["READY", "PENDING_APPROVAL", "APPROVED"] as const;

export function isRevisableProposal(proposal: Proposal | undefined): proposal is Proposal {
  return !!proposal && (REVISABLE_STATUSES as readonly string[]).includes(proposal.status);
}

/**
 * Resolves the active proposal for a conversation thread.
 * Prefers the latest proposal in the thread that is still revisable/actionable
 * (READY, PENDING_APPROVAL, APPROVED) so a rejected/BLOCKED revision attempt
 * does not hide or deactivate the still-live proposal.
 */
export function resolveActiveProposal(
  thread: Pick<Thread, "proposals"> | undefined,
  proposals: readonly Proposal[],
): Proposal | undefined {
  if (!thread || thread.proposals.length === 0) return undefined;
  const resolved = thread.proposals
    .map((id) => proposals.find((p) => p.id === id))
    .filter((p): p is Proposal => p !== undefined);
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (isRevisableProposal(resolved[i])) return resolved[i];
  }
  return resolved.at(-1);
}

export function buildSwapChipText(proposal: Proposal | undefined): string | null {
  if (!isRevisableProposal(proposal) || !proposal.selection) return null;
  const lineIds = new Set(proposal.lines.map((l) => l.productId));
  for (const step of proposal.selection.pipeline) {
    const currentLine =
      proposal.lines.find((l) => l.productId === step.selectedProduct?.id) ??
      proposal.lines.find((l) => step.sortedCandidates.some((c) => c.id === l.productId));
    const alt = step.sortedCandidates.find((c) => !lineIds.has(c.id));
    if (currentLine && alt) return `Change ${currentLine.name} to ${alt.name}`;
  }
  for (const sug of proposal.selection.suggestedAlternatives) {
    const currentLine = proposal.lines.find((l) => l.productId === sug.forProductId);
    const alt = sug.alternatives.find((c) => !lineIds.has(c.id));
    if (currentLine && alt) return `Change ${currentLine.name} to ${alt.name}`;
  }
  return null;
}

export type ParsedSwapResult =
  | { recognized: false }
  | { recognized: true; swap: { fromProductId: string; toProductId: string } }
  | { recognized: true; swap: null; error: string };

const QUANTITY_UNIT_PATTERN =
  "kg|g|dl|cl|ml|litres?|liters?|l|st|ki|kpl|pcs|cases?|packs?|units?";

const PURE_QUANTITY_RE = new RegExp(
  `^[\\d,.]+(?:\\s*(?:${QUANTITY_UNIT_PATTERN}))?$`,
  "i",
);

const QUANTITY_ONLY_RE = new RegExp(
  `^(?:make|change|set)(?:\\s+it|\\s+the\\s+quantity)?\\s+(?:to\\s+)?([\\d,.]+)(?:\\s*(${QUANTITY_UNIT_PATTERN}))?[.!?]*$`,
  "i",
);

const LINE_QUANTITY_TO_RE = new RegExp(
  `^(?:make|change|set)\\s+(.+?)\\s+to\\s+([\\d,.]+)(?:\\s*(${QUANTITY_UNIT_PATTERN}))?[.!?]*$`,
  "i",
);

const LINE_QUANTITY_RE = new RegExp(
  `^(?:make|change|set)\\s+(.+?)\\s+([\\d,.]+)(?:\\s*(${QUANTITY_UNIT_PATTERN}))?[.!?]*$`,
  "i",
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesWordBoundary(haystack: string, needle: string): boolean {
  const trimmed = needle.trim();
  if (!trimmed) return false;
  return new RegExp(`(?<!\\w)${escapeRegExp(trimmed)}(?!\\w)`, "i").test(haystack);
}

function normalizeQuantityUnit(rawUnit: string | undefined, fallbackSalesUnit?: string | null): string {
  const u = (rawUnit ?? fallbackSalesUnit ?? "ST").toUpperCase();
  if (/^LIT/.test(u)) return "L";
  if (/^CASE/.test(u)) return "KI";
  if (u === "KPL" || u === "PCS" || /^UNIT/.test(u)) return "ST";
  if (/^PACK/.test(u)) return "PAK";
  return u;
}

export type ParsedQuantityRevision =
  | { recognized: false }
  | {
      recognized: true;
      productId: string;
      lineName: string;
      salesUnit?: string | null;
      quantity: number;
      unit: string;
    };

export function parseQuantityRevisionCommand(
  text: string,
  proposal: Proposal | undefined,
): ParsedQuantityRevision {
  const trimmed = text.trim();
  if (!proposal || proposal.lines.length === 0) return { recognized: false };

  const onlyMatch = trimmed.match(QUANTITY_ONLY_RE);
  if (onlyMatch) {
    const qty = Number(onlyMatch[1]!.replace(/,/g, ""));
    if (!Number.isFinite(qty) || qty <= 0) return { recognized: false };
    const first = proposal.lines[0]!;
    return {
      recognized: true,
      productId: first.productId,
      lineName: first.name,
      salesUnit: first.salesUnit,
      quantity: qty,
      unit: normalizeQuantityUnit(onlyMatch[2], first.salesUnit),
    };
  }

  const lineMatch = trimmed.match(LINE_QUANTITY_TO_RE) ?? trimmed.match(LINE_QUANTITY_RE);
  if (!lineMatch) return { recognized: false };

  const targetLower = lineMatch[1]!.trim().toLowerCase();
  const qty = Number(lineMatch[2]!.replace(/,/g, ""));
  if (!targetLower || !Number.isFinite(qty) || qty <= 0) return { recognized: false };

  const byLength = [...proposal.lines].sort((a, b) => b.name.length - a.name.length);
  const line =
    byLength.find(
      (l) => l.productId.toLowerCase() === targetLower || l.name.toLowerCase() === targetLower,
    ) ?? byLength.find((l) => matchesWordBoundary(l.name, targetLower));

  if (!line) return { recognized: false };

  return {
    recognized: true,
    productId: line.productId,
    lineName: line.name,
    salesUnit: line.salesUnit,
    quantity: qty,
    unit: normalizeQuantityUnit(lineMatch[3], line.salesUnit),
  };
}

export function parseSwapCommand(
  text: string,
  proposal: Proposal | undefined,
): ParsedSwapResult {
  const trimmed = text.trim();
  const legacyMatch = /^change\s+product\s+to\s+another\s+alternative[.!?]*$/i.test(trimmed);
  const explicitMatch = trimmed.match(/^(?:change|swap|replace)\s+(.+?)\s+(?:to|with|for)\s+(.+?)[.!?]*$/i);
  if (!legacyMatch && !explicitMatch) return { recognized: false };

  if (explicitMatch) {
    const fromLower = explicitMatch[1]!.trim().toLowerCase();
    const toTrimmed = explicitMatch[2]!.trim();
    if (
      fromLower === "it" ||
      fromLower === "the quantity" ||
      fromLower === "quantity" ||
      PURE_QUANTITY_RE.test(toTrimmed)
    ) {
      return { recognized: false };
    }
  }

  if (!isRevisableProposal(proposal)) {
    return {
      recognized: true,
      swap: null,
      error: "There is no active revisable proposal to swap products on.",
    };
  }

  if (legacyMatch) {
    const lineIds = new Set(proposal.lines.map((l) => l.productId));
    for (const step of proposal.selection?.pipeline ?? []) {
      const line =
        proposal.lines.find((l) => l.productId === step.selectedProduct?.id) ??
        proposal.lines.find((l) => step.sortedCandidates.some((c) => c.id === l.productId));
      const alt = step.sortedCandidates.find((c) => !lineIds.has(c.id));
      if (line && alt) {
        return { recognized: true, swap: { fromProductId: line.productId, toProductId: alt.id } };
      }
    }
    for (const sug of proposal.selection?.suggestedAlternatives ?? []) {
      const line = proposal.lines.find((l) => l.productId === sug.forProductId);
      const alt = sug.alternatives.find((c) => !lineIds.has(c.id));
      if (line && alt) {
        return { recognized: true, swap: { fromProductId: line.productId, toProductId: alt.id } };
      }
    }
    return {
      recognized: true,
      swap: null,
      error: "No alternative product is available to swap in the current proposal.",
    };
  }

  const body = trimmed.replace(/^(?:change|swap|replace)\s+/i, "").replace(/[.!?]+$/, "").trim();

  // Match group 1 against current proposal's line names/ids FIRST (longest case-insensitive match)
  const lineKeys: Array<{ line: Proposal["lines"][number]; key: string }> = [];
  for (const line of proposal.lines) {
    lineKeys.push({ line, key: line.name.trim().toLowerCase() });
    lineKeys.push({ line, key: line.productId.trim().toLowerCase() });
  }
  lineKeys.sort((a, b) => b.key.length - a.key.length);

  let fromLine: Proposal["lines"][number] | undefined;
  let toRaw = "";
  const bodyLower = body.toLowerCase();

  for (const entry of lineKeys) {
    if (!entry.key || !bodyLower.startsWith(entry.key)) continue;
    const after = body.slice(entry.key.length);
    const sep = after.match(/^\s+(?:to|with|for)\s+(.+)$/i);
    if (sep) {
      fromLine = entry.line;
      toRaw = sep[1]!.trim();
      break;
    }
  }

  // Fallback: split on separator and match partial line name/id
  if (!fromLine) {
    const [, fromPart, toPart] = explicitMatch!;
    const fromLower = fromPart!.trim().toLowerCase();
    fromLine =
      proposal.lines.find(
        (l) => l.productId.toLowerCase() === fromLower || l.name.toLowerCase() === fromLower,
      ) ??
      proposal.lines.find((l) => matchesWordBoundary(l.name, fromLower));
    toRaw = toPart!.trim();
  }

  if (!fromLine) {
    return {
      recognized: true,
      swap: null,
      error: `Could not find that product in the current proposal (${proposal.lines.map((l) => l.name).join(", ")}).`,
    };
  }

  // Collect all candidate alternatives from selection.pipeline & suggestedAlternatives
  const candidates: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  const addCandidate = (c: { id: string; name: string }) => {
    if (c.id === fromLine!.productId || seen.has(c.id)) return;
    seen.add(c.id);
    candidates.push(c);
  };

  for (const step of proposal.selection?.pipeline ?? []) {
    const matchesStep =
      step.selectedProduct?.id === fromLine.productId ||
      step.sortedCandidates.some((c) => c.id === fromLine!.productId);
    if (matchesStep) {
      for (const c of step.sortedCandidates) addCandidate(c);
    }
  }
  for (const sug of proposal.selection?.suggestedAlternatives ?? []) {
    if (sug.forProductId === fromLine.productId) {
      for (const c of sug.alternatives) addCandidate(c);
    }
  }
  for (const step of proposal.selection?.pipeline ?? []) {
    for (const c of step.sortedCandidates) addCandidate(c);
  }
  for (const sug of proposal.selection?.suggestedAlternatives ?? []) {
    for (const c of sug.alternatives) addCandidate(c);
  }

  const toLower = toRaw.toLowerCase();
  const sortedByLen = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const toMatch =
    sortedByLen.find((c) => c.id.toLowerCase() === toLower || c.name.toLowerCase() === toLower) ??
    sortedByLen.find((c) => matchesWordBoundary(c.name, toLower));

  if (!toMatch) {
    return {
      recognized: true,
      swap: null,
      error: `Could not find alternative "${toRaw}" for ${fromLine.name}. Choose an available alternative from the selection list below.`,
    };
  }

  return {
    recognized: true,
    swap: { fromProductId: fromLine.productId, toProductId: toMatch.id },
  };
}

export function compatibleQuantity(quantity: number, from: string, to: string): number | null {
  const units: Record<string, { group: string; ratio: number }> = {
    KG: { group: "mass", ratio: 1 },
    G: { group: "mass", ratio: 0.001 },
    L: { group: "volume", ratio: 1 },
    DL: { group: "volume", ratio: 0.1 },
    CL: { group: "volume", ratio: 0.01 },
    ML: { group: "volume", ratio: 0.001 },
  };
  const a = from.toUpperCase();
  const b = to.toUpperCase();
  if (a === b) return quantity;
  return units[a] && units[b] && units[a].group === units[b].group
    ? (quantity * units[a].ratio) / units[b].ratio
    : null;
}

export function convertToSalesUnits(
  product: Pick<ProductDetail, "salesUnit" | "baseUnit" | "units" | "netWeightKg" | "contentPerSalesUnit">,
  quantity: number,
  unit: string,
): { quantity: number; converted: boolean } | null {
  const direct = compatibleQuantity(quantity, unit, product.salesUnit);
  if (direct !== null) {
    return {
      quantity: Math.round(direct * 1000) / 1000,
      converted: unit.toUpperCase() !== product.salesUnit.toUpperCase(),
    };
  }
  if (product.contentPerSalesUnit && product.contentPerSalesUnit.value > 0) {
    const inContent = compatibleQuantity(quantity, unit, product.contentPerSalesUnit.unit);
    if (inContent !== null) {
      return {
        quantity: Math.ceil(inContent / product.contentPerSalesUnit.value),
        converted: true,
      };
    }
  }
  const unitInfo = product.units.find((u) => u.unitId === product.salesUnit);
  if (unitInfo?.sizeInBaseUnits) {
    const inBase = compatibleQuantity(quantity, unit, product.baseUnit);
    if (inBase !== null) {
      return {
        quantity: Math.ceil(inBase / unitInfo.sizeInBaseUnits),
        converted: true,
      };
    }
    const kg = compatibleQuantity(quantity, unit, "KG");
    if (kg !== null && product.netWeightKg) {
      return {
        quantity: Math.ceil(kg / (product.netWeightKg * unitInfo.sizeInBaseUnits)),
        converted: true,
      };
    }
  }
  return null;
}

export function recipeNeeds(recipe: Recipe, servings: number, inventory: InventoryItem[]) {
  const grouped: Recipe["ingredients"] = [];
  for (const ingredient of recipe.ingredients) {
    const previous = grouped.find(
      (i) =>
        i.productName.toLowerCase() === ingredient.productName.toLowerCase() &&
        compatibleQuantity(ingredient.quantity, ingredient.unit, i.unit) !== null,
    );
    if (previous) {
      previous.quantity += compatibleQuantity(ingredient.quantity, ingredient.unit, previous.unit)!;
    } else {
      grouped.push({ ...ingredient });
    }
  }
  return grouped.map((ingredient) => {
    const needed = (ingredient.quantity * servings) / recipe.baseServings;
    const ingLower = ingredient.productName.toLowerCase();
    const exact = inventory.filter((i) => i.ingredientName.toLowerCase() === ingLower);
    const stock =
      exact.length > 0
        ? exact
        : inventory.filter((i) => {
            const invLower = i.ingredientName.toLowerCase();
            return invLower.includes(ingLower) || ingLower.includes(invLower);
          });
    const usable = stock.reduce(
      (sum, i) => sum + (compatibleQuantity(i.quantityInStock, i.unit, ingredient.unit) ?? 0),
      0,
    );
    return {
      ingredient,
      needed,
      stock: usable,
      shortage: Math.max(0, needed - usable),
      inventory: stock,
    };
  });
}

export function findMatchingRecipe(text: string, recipes: readonly Recipe[]): Recipe | undefined {
  const lower = text.toLowerCase();
  const exact = recipes.find((r) => {
    const cleanName = r.name.toLowerCase().split(" (")[0]!.split(" — ")[0]!.trim();
    return (
      lower.includes(r.name.toLowerCase()) ||
      (cleanName.length > 0 && lower.includes(cleanName)) ||
      lower.includes(r.id.toLowerCase().replace(/-/g, " ")) ||
      r.tags.some((tag) => lower.includes(tag.toLowerCase().replace(/-/g, " ")))
    );
  });
  if (exact) return exact;

  let best: Recipe | undefined;
  let bestScore = 0;
  let tied = false;
  for (const r of recipes) {
    const words = r.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    const hits = words.filter((w) => lower.includes(w)).length;
    if (hits > bestScore && (hits >= 2 || (hits === 1 && words.length <= 2))) {
      best = r;
      bestScore = hits;
      tied = false;
    } else if (hits > 0 && hits === bestScore) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}
