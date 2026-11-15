import "server-only";

import type { CandidateProduct } from "@/shared/contracts/selection";

// Name matching for product search and the agent's selection (pure, no DB, tested): how well a
// catalog name fits what a buyer asked for, which words change the product ("coffee milk" is not
// milk), and the relevance filter. Shared by services/selection.ts and services/catalog.ts.

/**
 * Generic culinary/packaging modifiers that must not match unrelated products on their own
 * during fallback catalog queries or name scoring.
 */
export const GENERIC_MODIFIERS = new Set([
  "fresh",
  "diced",
  "sliced",
  "chopped",
  "minced",
  "grated",
  "shredded",
  "organic",
  "unsalted",
  "salted",
  "whole",
  "frozen",
  "raw",
  "cooked",
  "local",
  "natural",
  "pure",
  "extra",
  "large",
  "small",
  "medium",
  "young",
  "baby",
  "lean",
  "tuore",
  "pakaste",
  "luomu",
  "suolaton",
]);

const INGREDIENT_CHANGING_QUALIFIERS = new Set([
  "sweet",
  "wild",
  "smoked",
  "cured",
  "pickled",
  "marinated",
  "candied",
  "spiced",
  "flavored",
  "flavoured",
  "fermented",
  "imitation",
  "vegan",
  "plant",
  "oat",
  "soy",
  "almond",
  "coconut",
  "rice",
  "horseradish",
  "jerusalem",
  "water",
  "garlic",
  "chili",
  "chilli",
  "herb",
  "lemon",
  "honey",
  "truffle",
  "curry",
  "mustard",
  "smashed",
  "mashed",
  "cocoa",
  "ice",
  "chocolate",
  "sour",
  "brioche",
  "burger",
  "lolly",
  "dipmix",
  "shaker",
  "beans",
  "bean",
  "spreader",
  "jug",
  "scoop",
  "slicer",
  "onion",
  "tomato",
  "cheese",
  "peanut",
  "balsamic",
  "condensed",
  "condensated",
  "caramelized",
  "caramelised",
  "evaporated",
  "saithe",
  // Drinks and flavours that make a different product of the base ("coffee milk" is not milk).
  "coffee",
  "latte",
  "cappuccino",
  "mocha",
  "vanilla",
  "strawberry",
  "banana",
  "blueberry",
  "raspberry",
]);

const MODIFIER_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["diced", "dice", "dices", "cube", "cubes", "cubed"],
  ["sliced", "slice", "slices", "ring", "rings"],
  ["chopped", "chop", "minced", "mince"],
  ["shredded", "shred", "grated", "grate"],
  ["mashed", "mash", "smashed", "smash", "puree", "purée"],
  ["fillet", "fillets", "filet", "filets"],
];

export const SYNONYM_LOOKUP = new Map<string, Set<string>>(
  MODIFIER_SYNONYM_GROUPS.flatMap((group) => {
    const set = new Set(group);
    return group.map((w) => [w, set] as const);
  }),
);

const OPPOSITE_MODIFIER_PAIRS: readonly (readonly [string, string])[] = [
  ["unsalted", "salted"],
  ["suolaton", "suolattu"],
  ["unsalted", "suolattu"],
  ["salted", "unsalted"],
  ["unsweetened", "sweetened"],
  ["unsweetened", "sweet"],
  ["sweetened", "unsweetened"],
  ["unflavored", "flavored"],
  ["unflavored", "flavoured"],
  ["unflavoured", "flavoured"],
  ["unflavoured", "flavored"],
];

/** Valio ERP 2-digit category prefixes that represent non-food items (utensils, packaging, office, etc.). */
export const NON_FOOD_CATEGORY_PREFIXES = new Set(["20", "30", "32", "63", "64", "67", "77", "90"]);

/** Returns true when the product's catalog classification (category prefix or STANDARD VAT) is non-food. */
export function isNonFoodProduct(category: string, vatCode?: string | null): boolean {
  const prefix = category.trim().slice(0, 2);
  if (NON_FOOD_CATEGORY_PREFIXES.has(prefix)) return true;
  if (vatCode && vatCode.toUpperCase().includes("STANDARD")) return true;
  return false;
}

const DERIVED_OR_DIFFERENT_HEAD_NOUNS = new Set([
  "gnocchi",
  "salad",
  "salads",
  "chips",
  "chip",
  "crisps",
  "crisp",
  "starch",
  "powder",
  "flake",
  "flakes",
  "casserole",
  "soup",
  "soups",
  "flatbread",
  "bread",
  "bun",
  "buns",
  "roll",
  "rolls",
  "rosti",
  "peeler",
  "press",
  "masher",
  "ricer",
  "herring",
  "fish",
  "salmon",
  "cheese",
  "sauce",
  "sauces",
  "dip",
  "dips",
  "dressing",
  "seasoning",
  "spice",
  "seed",
  "seeds",
  "fond",
  "broth",
  "stock",
  "brine",
  "gum",
  "beer",
  "drink",
  "drinks",
  "juice",
  "tea",
  "jam",
  "jelly",
  "syrup",
  "oil",
  "vinegar",
  "pasta",
  "noodle",
  "noodles",
  "pie",
  "cake",
  "cookie",
  "cookies",
  "cracker",
  "crackers",
  "snack",
  "snacks",
  "wedges",
  "fries",
  "puree",
  "purée",
  "paste",
  "extract",
  "essence",
  "mayo",
  "mayonnaise",
  "mustard",
  "ketchup",
  "butter",
  "potato",
  "potatoes",
]);

/**
 * Extra words that still name the same product as the requested word: a variety plus its class noun
 * ("Cheddar" → "Valio Cheddar cheese", "rapeseed" → "Rapeseed oil") or a product sold under a
 * longer name ("milk" → "lactose free milk drink"). They skip the qualifier/head-noun penalty, which
 * otherwise rejects "Potato salad" for "potato" or "Cocoa butter" for "butter".
 */
const SAME_PRODUCT_EXTRA_WORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  (
    [
      // Only unambiguous varieties: "cream" (cream cheese), "olive" (olives) and "sesame" (seeds) stay out.
      [["cheddar", "emmental", "emmentaler", "edam", "gouda", "mozzarella", "brie", "camembert", "feta", "parmesan",
        "halloumi", "mascarpone", "ricotta", "gruyere", "gruyère", "oltermanni"], ["cheese"]],
      [["rapeseed", "sunflower", "canola", "rypsi"], ["oil"]],
      [["milk"], ["drink"]],
    ] as const
  ).flatMap(([words, extras]) => words.map((w) => [w, new Set<string>(extras)] as const)),
);

/** Strips verb endings for inflection matching: "skimmed" → "skim", "whipping" / "whipped" → "whip". */
function verbStem(word: string): string {
  const m = /^(.{3,}?)(?:ing|ed)$/.exec(word);
  if (!m) return word;
  const stem = m[1]!;
  return /([b-df-hj-np-tv-z])\1$/.test(stem) ? stem.slice(0, -1) : stem;
}

/** Returns a word and its singularized English stem (e.g. "potatoes" → "potato", "cheeses" → "cheese"). */
export function wordStems(word: string): string[] {
  const lower = word.trim().toLowerCase();
  if (!lower) return [];
  if (lower.endsWith("ies") && lower.length > 4) {
    return [lower, `${lower.slice(0, -3)}y`];
  }
  if (lower.endsWith("oes") && lower.length > 4) {
    return [lower, lower.slice(0, -2)];
  }
  if (/(?:ches|shes|xes|sses|zes)$/.test(lower) && lower.length > 4) {
    return [lower, lower.slice(0, -2)];
  }
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) {
    return [lower, lower.slice(0, -1)];
  }
  return [lower];
}

/**
 * Calculates similarity between requested productName and candidate product name in [0, 1].
 * Combines exact/stem/substring checks with prefix matching (requiring token length >= 3)
 * and prevents generic modifier-only matches, unrequested ingredient-changing qualifiers,
 * and derived/compound head nouns from clearing the relevance floor when a plain match exists.
 */
export function computeNameMatchScore(requestedName: string, candidateName: string): number {
  const reqNorm = requestedName.trim().toLowerCase();
  const candNorm = candidateName.trim().toLowerCase();
  if (!reqNorm || !candNorm) return 0;
  if (reqNorm === candNorm) return 1;

  const tokenize = (s: string) =>
    s
      .replace(/[^a-z0-9äöå]+/gi, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  const reqTokens = tokenize(reqNorm);
  const candTokens = tokenize(candNorm);
  if (reqTokens.length === 0 || candTokens.length === 0) return 0;

  const reqStemSet = new Set(reqTokens.flatMap(wordStems));
  const candStemSet = new Set(candTokens.flatMap(wordStems));
  const coreReqTokens = reqTokens.filter((t) => !GENERIC_MODIFIERS.has(t));

  let matchedReqTokens = 0;
  let matchedCoreTokens = 0;
  let unmatchedCoreCount = 0;
  const matchedCoreIndices: number[] = [];

  // Same word in another form: a short ending ("dice"/"diced") or a verb form ("skim"/"skimmed",
  // "whipping"/"whipped"). Stems must keep 3+ letters, so "oat" never matches "oatmeal".
  const isInflectionPrefix = (a: string, b: string) =>
    a.length >= 3 &&
    b.length >= 3 &&
    ((b.startsWith(a) && b.length - a.length <= 2) ||
      (a.startsWith(b) && a.length - b.length <= 2) ||
      verbStem(a) === verbStem(b));

  for (const rt of reqTokens) {
    const rtStems = wordStems(rt);
    const rtSynonyms = SYNONYM_LOOKUP.get(rt);
    const isCore = !GENERIC_MODIFIERS.has(rt);
    let tokenScore = 0;

    if (candTokens.includes(rt) || rtStems.some((s) => candStemSet.has(s))) {
      tokenScore = 1;
      if (isCore) {
        candTokens.forEach((ct, idx) => {
          if (ct === rt || wordStems(ct).some((cs) => rtStems.includes(cs))) {
            matchedCoreIndices.push(idx);
          }
        });
      }
    } else if (rtSynonyms && candTokens.some((ct) => rtSynonyms.has(ct))) {
      tokenScore = 0.95;
      if (isCore) {
        candTokens.forEach((ct, idx) => {
          if (rtSynonyms.has(ct)) {
            matchedCoreIndices.push(idx);
          }
        });
      }
    } else if (candTokens.some((ct) => isInflectionPrefix(rt, ct))) {
      tokenScore = 0.75;
      if (isCore) {
        candTokens.forEach((ct, idx) => {
          if (isInflectionPrefix(rt, ct)) {
            matchedCoreIndices.push(idx);
          }
        });
      }
    }

    matchedReqTokens += tokenScore;
    if (isCore) {
      if (tokenScore === 0) {
        unmatchedCoreCount++;
      } else {
        matchedCoreTokens += tokenScore;
      }
    }
  }

  // Every core (non-modifier) request token must match; partial core matches (e.g. "unicorn milk"
  // matching only "milk") must not clear the 0.35 relevance floor.
  if (coreReqTokens.length > 0 && unmatchedCoreCount > 0) {
    return Math.min(0.25, Math.round((matchedCoreTokens / coreReqTokens.length) * 0.25 * 1000) / 1000);
  }

  const reqCoverage = matchedReqTokens / reqTokens.length;
  const effectiveReqCoverage =
    coreReqTokens.length > 0 && coreReqTokens.length < reqTokens.length
      ? Math.max(reqCoverage, (matchedCoreTokens / coreReqTokens.length) * 0.85)
      : reqCoverage;
  const candCoverage = matchedReqTokens / candTokens.length;
  const substringBonus = candNorm.includes(reqNorm) ? 0.2 : 0;

  let rawScore = effectiveReqCoverage * 0.7 + candCoverage * 0.2 + substringBonus;

  // Opposite modifier check (e.g. requested "unsalted" must penalize "salted" and vice versa).
  const hasOppositeModifier = OPPOSITE_MODIFIER_PAIRS.some(
    ([reqMod, oppMod]) => reqStemSet.has(reqMod) && !reqStemSet.has(oppMod) && candStemSet.has(oppMod),
  );
  if (hasOppositeModifier) {
    rawScore *= 0.2;
  }

  // "<word> free" means without it: "Milk free margarine" is not milk, unless "milk free" was asked.
  const freeOf = (tokens: string[], word: string) =>
    tokens.some((t, i) => t === word && (tokens[i + 1] === "free" || tokens[i + 1] === "vapaa"));
  if (coreReqTokens.some((rt) => freeOf(candTokens, rt) && !freeOf(reqTokens, rt))) {
    rawScore *= 0.2;
  }

  if (coreReqTokens.length > 0 && matchedCoreIndices.length > 0) {
    // Words that only complete the requested product's name ("Cheddar" + "cheese") are not penalized.
    const sameProductExtras = new Set(reqTokens.flatMap((t) => [...(SAME_PRODUCT_EXTRA_WORDS.get(t) ?? [])]));
    const isSameProductExtra = (ct: string) => wordStems(ct).some((s) => sameProductExtras.has(s));

    // (a) Penalize unrequested ingredient-changing qualifiers anywhere in the candidate name
    // (e.g. "Smoked salmon fillet" for "Salmon fillet", "Cocoa butter" for "butter",
    // "smashed potatoes" for "Diced potatoes").
    const hasUnrequestedQualifier = candTokens.some((ct, idx) => {
      if (matchedCoreIndices.includes(idx) || isSameProductExtra(ct)) return false;
      const stems = wordStems(ct);
      if (stems.some((s) => reqStemSet.has(s))) return false;
      return INGREDIENT_CHANGING_QUALIFIERS.has(ct) || stems.some((s) => INGREDIENT_CHANGING_QUALIFIERS.has(s));
    });

    // (b) Penalize matched core noun used as a modifier of a different head noun
    // (e.g. "Potato Gnocchi", "Potato Salad", "Potato Peeler", "dill herring").
    const hasDifferentHeadNoun = candTokens.some(
      (ct, idx) =>
        !matchedCoreIndices.includes(idx) &&
        !isSameProductExtra(ct) &&
        DERIVED_OR_DIFFERENT_HEAD_NOUNS.has(ct) &&
        !reqStemSet.has(ct) &&
        !wordStems(ct).some((s) => reqStemSet.has(s)),
    );

    if (hasUnrequestedQualifier || hasDifferentHeadNoun) {
      rawScore *= 0.35;
    }
  }

  return Math.min(1, Math.round(rawScore * 1000) / 1000);
}

/** Keeps only candidates meeting the 0.35 relevance floor and at least 70% of the top match. */
export function filterRelevantCandidates<T extends Pick<CandidateProduct, "nameMatchScore">>(
  candidates: readonly T[],
): T[] {
  const topMatch = Math.max(0, ...candidates.map((c) => c.nameMatchScore));
  const minScore = Math.max(0.35, topMatch * 0.7);
  return candidates.filter((c) => c.nameMatchScore >= minScore);
}

/**
 * Drops non-food items (utensils, packaging, STANDARD VAT) whenever at least one food item
 * clears the 0.35 relevance floor; keeps non-food items when the request itself is non-food
 * (e.g. "Potato peeler").
 */
export function filterFoodCandidatesIfAvailable<
  T extends { category: string; vatCode?: string | null; nameMatchScore: number },
>(candidates: readonly T[]): T[] {
  const foodRelevant = candidates.filter(
    (c) => !isNonFoodProduct(c.category, c.vatCode) && c.nameMatchScore >= 0.35,
  );
  if (foodRelevant.length > 0) {
    return candidates.filter((c) => !isNonFoodProduct(c.category, c.vatCode));
  }
  return [...candidates];
}

/**
 * Category voting among relevant candidates: derives dominant category codes from the best
 * plain matches and keeps candidates in categories whose top score and vote weight are competitive.
 */
export function applyCategoryVoting<T extends { category: string; nameMatchScore: number }>(
  candidates: readonly T[],
): T[] {
  if (candidates.length <= 1) return [...candidates];

  const byCat = new Map<string, number[]>();
  for (const c of candidates) {
    const arr = byCat.get(c.category) ?? [];
    arr.push(c.nameMatchScore);
    byCat.set(c.category, arr);
  }
  if (byCat.size <= 1) return [...candidates];

  const stats = [...byCat.entries()].map(([category, scores]) => {
    const sorted = [...scores].sort((a, b) => b - a);
    const maxScore = sorted[0] ?? 0;
    const topSum = sorted.slice(0, 5).reduce((acc, s) => acc + s * s, 0);
    return { category, maxScore, topSum };
  });

  const bestMaxScore = Math.max(...stats.map((s) => s.maxScore));
  const bestTopSum = Math.max(...stats.map((s) => s.topSum));
  const dominant = new Set(
    stats
      .filter((s) => s.maxScore >= bestMaxScore - 0.12 && s.topSum >= bestTopSum * 0.2)
      .map((s) => s.category),
  );

  const filtered = candidates.filter((c) => dominant.has(c.category));
  return filtered.length > 0 ? filtered : [...candidates];
}

/**
 * Full pure relevance pipeline:
 * 1. Exclude non-food items when food candidates exist.
 * 2. Keep candidates meeting the relevance floor (>= 0.35 and >= 70% of top).
 * 3. Restrict to dominant category code(s) via category voting.
 */
export function selectRelevantCandidates<
  T extends { category: string; vatCode?: string | null; nameMatchScore: number },
>(candidates: readonly T[]): T[] {
  const foodFirst = filterFoodCandidatesIfAvailable(candidates);
  const relevant = filterRelevantCandidates(foodFirst);
  return applyCategoryVoting(relevant);
}
