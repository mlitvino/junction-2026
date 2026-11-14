import "server-only";

// Converts a requested amount ("1000 L", "420 kg", "20 cases", "12") into the product's sales unit,
// using the catalog's packaging data: `units[].sizeInBaseUnits` (e.g. KI = 5 ST) and the net
// content of one base unit (e.g. 1 L). Pure functions, no database: `pnpm test:server` runs them.

export type UnitFacts = {
  salesUnit: string;
  baseUnit: string;
  units: readonly { unitId: string; sizeInBaseUnits: number }[];
  /** Net content of one base unit in `contentUnit`; null when the catalog doesn't declare it. */
  contentPerBaseUnit: number | null;
  contentUnit: "L" | "KG" | string | null;
};

export type Conversion = {
  /** How many sales units to order (rounded up). */
  quantity: number;
  salesUnit: string;
  /** Net content of one sales unit (e.g. 5 L per case), when known. */
  perSalesUnit: { value: number; unit: "L" | "KG" } | null;
  /** True when the requested amount could be converted; false = taken as sales units unchanged. */
  converted: boolean;
  /** Human-readable explanation, e.g. "1000 L → 200 KI (5 L each)". */
  note: string;
};

const DIMENSIONS: Record<string, { unit: "L" | "KG"; factor: number }> = {
  l: { unit: "L", factor: 1 }, lt: { unit: "L", factor: 1 }, ltr: { unit: "L", factor: 1 },
  liter: { unit: "L", factor: 1 }, liters: { unit: "L", factor: 1 }, litre: { unit: "L", factor: 1 },
  litres: { unit: "L", factor: 1 }, litra: { unit: "L", factor: 1 }, litraa: { unit: "L", factor: 1 },
  dl: { unit: "L", factor: 0.1 }, cl: { unit: "L", factor: 0.01 }, ml: { unit: "L", factor: 0.001 },
  kg: { unit: "KG", factor: 1 }, kgs: { unit: "KG", factor: 1 }, kilo: { unit: "KG", factor: 1 },
  kilos: { unit: "KG", factor: 1 }, kilogram: { unit: "KG", factor: 1 }, kilograms: { unit: "KG", factor: 1 },
  g: { unit: "KG", factor: 0.001 }, gr: { unit: "KG", factor: 0.001 }, gram: { unit: "KG", factor: 0.001 },
  grams: { unit: "KG", factor: 0.001 }, t: { unit: "KG", factor: 1000 }, tonne: { unit: "KG", factor: 1000 },
};

/** Words for packaging levels that aren't the product's own unit codes. */
const CASE_WORDS = new Set(["case", "cases", "box", "boxes", "carton", "cartons", "laatikko", "laatikkoa", "ki"]);
const PIECE_WORDS = new Set(["pc", "pcs", "piece", "pieces", "kpl", "each", "unit", "units", "st"]);

const round = (n: number) => Math.round(n * 1000) / 1000;
/** Ceil that ignores floating-point noise (199.99999 → 200). */
const ceil = (n: number) => Math.ceil(n - 1e-9);

function sizeOf(facts: UnitFacts, unitId: string): number | null {
  if (unitId.toUpperCase() === facts.baseUnit.toUpperCase()) return 1;
  return facts.units.find((u) => u.unitId.toUpperCase() === unitId.toUpperCase())?.sizeInBaseUnits ?? null;
}

/** Converts `amount` of `unit` (any spelling, or empty = sales units) into the product's sales unit. */
export function toSalesUnits(amount: number, unit: string | null | undefined, facts: UnitFacts): Conversion {
  const salesUnit = facts.salesUnit;
  const salesSize = sizeOf(facts, salesUnit);
  const content =
    facts.contentPerBaseUnit && (facts.contentUnit === "L" || facts.contentUnit === "KG") && salesSize
      ? { value: round(facts.contentPerBaseUnit * salesSize), unit: facts.contentUnit as "L" | "KG" }
      : null;
  const each = content ? ` (${content.value} ${content.unit} each)` : "";
  const word = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");

  // No unit, or already the sales unit: nothing to convert.
  if (!word || word === salesUnit.toLowerCase()) {
    return { quantity: ceil(amount), salesUnit, perSalesUnit: content, converted: true, note: `${amount} ${salesUnit}${each}` };
  }

  // A packaging level of this product (its own code, "case", "pieces").
  const code = facts.units.find((u) => u.unitId.toLowerCase() === word)?.unitId
    ?? (CASE_WORDS.has(word) && sizeOf(facts, "KI") ? "KI" : null)
    ?? (PIECE_WORDS.has(word) || word === facts.baseUnit.toLowerCase() ? facts.baseUnit : null);
  if (code && salesSize) {
    const baseUnits = amount * (sizeOf(facts, code) ?? 1);
    const quantity = ceil(baseUnits / salesSize);
    return { quantity, salesUnit, perSalesUnit: content, converted: true, note: `${amount} ${code} → ${quantity} ${salesUnit}${each}` };
  }

  // A volume or weight, converted through the declared net content.
  const dim = DIMENSIONS[word];
  if (dim && content && dim.unit === content.unit) {
    const wanted = amount * dim.factor;
    const quantity = ceil(wanted / content.value);
    return { quantity, salesUnit, perSalesUnit: content, converted: true, note: `${amount} ${unit} → ${quantity} ${salesUnit}${each}` };
  }

  const why = !dim
    ? `unknown unit '${unit}'`
    : !content
      ? "the catalog doesn't declare this product's content"
      : `the product is measured in ${content.unit}, not ${dim.unit}`;
  return {
    quantity: ceil(amount),
    salesUnit,
    perSalesUnit: content,
    converted: false,
    note: `${amount} ${unit} taken as ${ceil(amount)} ${salesUnit}: ${why}. Check the quantity.`,
  };
}
