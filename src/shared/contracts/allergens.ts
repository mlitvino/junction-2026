// Allergens: the catalog stores GS1 allergen codes (`AM`, `AW`, …, see `valio_product.allergens`).
// People and agents usually say names ("milk", "gluten"). Settings and filters accept either; both
// are expanded to the same set of GS1 codes before comparing, so "milk" and "AM" mean the same.
// Plain constants and functions only (shared zone: no zod needed, no other zones).

/** Allergen groups (EU-14 style) and the GS1 codes that belong to each. */
export const ALLERGEN_GROUPS: Readonly<Record<string, readonly string[]>> = {
  milk: ["AM", "ML"],
  gluten: ["AW", "UW", "GB", "GO", "NR", "GS", "GK"],
  "tree-nuts": ["AN", "SA", "SH", "SW", "SC", "SP", "SR", "SM", "ST"],
  peanuts: ["AP"],
  soy: ["AY"],
  eggs: ["AE"],
  fish: ["AF"],
  crustaceans: ["AC"],
  molluscs: ["UM"],
  sesame: ["AS"],
  mustard: ["BM"],
  celery: ["BC"],
  sulphites: ["AU"],
  lupin: ["NL"],
};

const GROUP_OF_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(ALLERGEN_GROUPS).flatMap(([name, codes]) => codes.map((code) => [code, name] as const)),
);

/** Names or codes (any case) → the GS1 codes they cover. Unknown entries are kept as codes. */
export function allergenCodes(entries: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const group = ALLERGEN_GROUPS[entry.toLowerCase()];
    if (group) group.forEach((code) => out.add(code));
    else out.add(entry.toUpperCase());
  }
  return out;
}

/** GS1 codes → allergen names for display (unknown codes stay as they are, lowercase). */
export function allergenNames(codes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    const upper = code.trim().toUpperCase();
    if (upper) out.add(GROUP_OF_CODE.get(upper) ?? upper.toLowerCase());
  }
  return [...out];
}

/** True when the product's codes include any excluded allergen (names or codes). */
export function containsExcludedAllergen(productCodes: readonly string[], excluded: readonly string[]): boolean {
  if (!excluded.length || !productCodes.length) return false;
  const banned = allergenCodes(excluded);
  return productCodes.some((code) => banned.has(code.trim().toUpperCase()));
}
