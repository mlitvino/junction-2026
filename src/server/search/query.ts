import "server-only";

import { wordStems } from "./name-match";

// Turns what a buyer types into search terms (pure, tested). "100 litres of lactose-free milk"
// becomes: terms [["milk"]], dietary ["lactose-free"]. Quantities and filler words aren't product
// words, dietary words become a filter on the imported tags, every word also matches its plural
// stem, and common Finnish food words also search their English name ("voita" → butter).

const STOP_WORDS = new Set(["of", "the", "for", "and", "with", "a", "an", "to", "some", "please", "in", "ja", "sekä"]);

const UNIT_WORDS = new Set([
  "l", "dl", "cl", "ml", "kg", "g", "gr", "litre", "litres", "liter", "liters", "litra", "litraa",
  "kilo", "kilos", "kiloa", "kilogram", "kilograms", "gram", "grams", "grammaa", "pcs", "pc", "piece",
  "pieces", "kpl", "case", "cases", "pack", "packs", "packet", "packets", "box", "boxes", "bottle",
  "bottles", "carton", "cartons", "x", "st", "ki", "unit", "units", "pullo", "pulloa", "laatikko",
]);

/** Single-token dietary words, and two-token ones ("lactose" + "free"). */
const DIETARY_WORDS: Record<string, string> = {
  laktoositon: "lactose-free",
  laktoosittomat: "lactose-free",
  lactosefree: "lactose-free",
  gluteeniton: "gluten-free",
  glutenfree: "gluten-free",
  vegan: "vegan",
  vegaani: "vegan",
  vegaaninen: "vegan",
  vegetarian: "vegetarian",
  kasvis: "vegetarian",
};
const DIETARY_PAIRS: Record<string, string> = { lactose: "lactose-free", gluten: "gluten-free" };

/**
 * Finnish food words (stem → English). A token matches when it starts with the stem and adds at
 * most 3 letters of inflection: "maitoa", "voita", "kermaa", "juustoa", "perunoita".
 */
const FINNISH_FOOD: readonly (readonly [string, string])[] = [
  ["maito", "milk"], ["voi", "butter"], ["kerma", "cream"], ["juust", "cheese"], ["perun", "potato"],
  ["loh", "salmon"], ["kana", "chicken"], ["liha", "meat"], ["leip", "bread"], ["mun", "egg"],
  ["jogurt", "yogurt"], ["rahka", "quark"], ["kahvi", "coffee"], ["sokeri", "sugar"], ["suola", "salt"],
  ["jauho", "flour"], ["öljy", "oil"], ["porkkan", "carrot"], ["sipul", "onion"], ["tomaat", "tomato"],
  ["omen", "apple"], ["mansik", "strawberry"], ["riisi", "rice"], ["kala", "fish"], ["tilli", "dill"],
];

export type ParsedQuery = {
  /** One group per product word; a product must match every group (any word in a group). */
  terms: string[][];
  /** Dietary tags implied by the words ("lactose-free"), to filter on the imported tags. */
  dietary: string[];
  /** The product words as typed (for similarity on Finnish/Swedish names). */
  text: string;
  /** The product words with Finnish food words in English (for scoring English names). */
  scoringText: string;
};

export function tokenize(q: string): string[] {
  return q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** "100", "2,5", "1l", "500ml" are amounts; 5+ digit numbers are product ids or GTINs and stay. */
const isQuantity = (t: string) => /^\d{1,4}([.,]\d+)?$/.test(t) || /^\d+([.,]\d+)?[a-z]{1,6}$/.test(t);

/** The English name of a Finnish food word ("voita" → "butter"), or null. */
export function finnishEnglish(token: string): string | null {
  const hit = FINNISH_FOOD.find(([stem]) => token.startsWith(stem) && token.length - stem.length <= 3);
  return hit ? hit[1] : null;
}

/**
 * The product words of a name as the agent's candidate search needs them: quantities, units and
 * filler words dropped, dietary words kept ("1,8 kg of lactose-free milk" → lactose, free, milk).
 */
export function productWords(name: string): string[] {
  return tokenize(name).filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !UNIT_WORDS.has(t) && !isQuantity(t));
}

/** A requested name ready for scoring against (English) catalog names: "2 kg voita" → "butter". */
export function scoringName(name: string): string {
  const words = productWords(name);
  return words.length ? words.map((w) => finnishEnglish(w) ?? w).join(" ") : name.trim().toLowerCase();
}

export function parseSearchQuery(q: string): ParsedQuery {
  const tokens = tokenize(q);
  const dietary = new Set<string>();
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const pair = DIETARY_PAIRS[t];
    if (pair && (tokens[i + 1] === "free" || tokens[i + 1] === "vapaa")) {
      dietary.add(pair);
      i++;
      continue;
    }
    if (DIETARY_WORDS[t]) {
      dietary.add(DIETARY_WORDS[t]);
      continue;
    }
    if (STOP_WORDS.has(t) || UNIT_WORDS.has(t) || isQuantity(t)) continue;
    words.push(t);
  }
  const terms = words.map((w) => {
    const english = finnishEnglish(w);
    return [...new Set([w, ...wordStems(w), ...(english ? [english] : [])])];
  });
  return {
    terms,
    dietary: [...dietary],
    text: words.join(" "),
    scoringText: words.map((w) => finnishEnglish(w) ?? w).join(" "),
  };
}

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent swaps), for typo correction:
 * "mlik" → "milk" is 1.
 */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/**
 * The catalog word a typo most likely meant: within 1 edit (words of 4–6 letters) or 2 (7+),
 * the most frequent one wins. Null when the word is fine (known) or nothing is close.
 */
export function correctWord(word: string, vocabulary: ReadonlyMap<string, number>): string | null {
  if (word.length < 4 || vocabulary.has(word)) return null;
  const max = word.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestCount = 0;
  let bestDist = Infinity;
  for (const [candidate, count] of vocabulary) {
    if (Math.abs(candidate.length - word.length) > max) continue;
    const dist = editDistance(word, candidate);
    if (dist <= max && (dist < bestDist || (dist === bestDist && count > bestCount))) {
      best = candidate;
      bestCount = count;
      bestDist = dist;
    }
  }
  return best;
}
