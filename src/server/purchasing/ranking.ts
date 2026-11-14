import "server-only";

import { SUSTAINABILITY_LABELS, labelName } from "@/shared/contracts/labels";

// Good / better / best ranking of candidate products for one requested item. Pure: no database, no
// network (`pnpm test:server`). Used by POST /api/products/rank and by the agent's selection, so a
// person and the agent see the same order and the same reasons.
//
// Score = weighted sum of factors in [0, 1]:
//   price 0.35 (per litre/kg when the content is known, so pack sizes compare fairly)
//   availability 0.25 (by the requested date, enough known stock)
//   relevance 0.10 (name match, ordered before)   reliability 0.10   CO2 0.10
//   organization preferences 0.10 (preferred origin, vendor, brand; sustainability labels)
// Products that can't be ordered (sales block, nothing deliverable, no price) are listed separately.

export const RANK_WEIGHTS = {
  price: 0.35,
  availability: 0.25,
  relevance: 0.1,
  reliability: 0.1,
  co2: 0.1,
  preferences: 0.1,
} as const;

export type RankCandidate = {
  id: string;
  name: string;
  brand: string | null;
  vendorName: string;
  countryOfOrigin: string | null;
  labels: readonly string[];
  /** EUR excl. VAT per sales unit; null = no price. */
  unitPriceExclVat: number | null;
  salesUnit: string;
  /** Net content of one sales unit, when known. */
  perSalesUnit: { value: number; unit: "L" | "KG" } | null;
  /** The requested amount in this product's sales units. */
  quantity: number;
  /** False when the requested amount couldn't be converted (e.g. litres asked, product sold by weight). */
  converted?: boolean;
  orderable: boolean | null;
  salesBlock: boolean;
  /** Earliest delivery date (YYYY-MM-DD…). */
  availableDate: string | null;
  /** Known stock in sales units; null = unknown. */
  availableQuantity: number | null;
  deliveryReliability: number | null;
  co2PerKg: number | null;
  /** 0–1 similarity to the requested name. */
  nameMatch: number;
  previouslyOrderedProduct: boolean;
  previouslyOrderedBrand: boolean;
};

export type RankPreferences = {
  requestedDate: string;
  preferredOriginCountries: readonly string[];
  preferredVendors: readonly string[];
  preferredBrands: readonly string[];
};

export type RankedCandidate = RankCandidate & {
  score: number;
  tier: "best" | "better" | "good" | null;
  lineTotalExclVat: number | null;
  /** € per L or kg when the content is known. */
  pricePerContent: { value: number; unit: "L" | "KG" } | null;
  factors: Record<keyof typeof RANK_WEIGHTS, number>;
  reasons: string[];
};

export type RankResult = { ranked: RankedCandidate[]; unavailable: (RankCandidate & { reason: string })[] };

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const eur = (n: number) => `€${n.toFixed(2)}`;
const lower = (list: readonly string[]) => new Set(list.map((v) => v.trim().toLowerCase()));

function unavailableReason(c: RankCandidate): string | null {
  if (c.salesBlock) return "sales-blocked";
  if (c.orderable === false) return "can't be delivered on any date";
  if (c.unitPriceExclVat === null) return "no price from Valio";
  return null;
}

export function rankCandidates(candidates: readonly RankCandidate[], prefs: RankPreferences): RankResult {
  const unavailable: RankResult["unavailable"] = [];
  const pool: RankCandidate[] = [];
  // When some products can take the requested amount (e.g. litres), the ones that can't aren't comparable.
  const someConvert = candidates.some((c) => c.converted !== false && !unavailableReason(c));
  for (const c of candidates) {
    const why = unavailableReason(c) ?? (someConvert && c.converted === false ? "the requested amount can't be converted to this product's unit" : null);
    if (why) unavailable.push({ ...c, reason: why });
    else pool.push(c);
  }

  // Compare price per content unit when every candidate declares the same dimension, else per sales unit.
  const dims = new Set(pool.map((c) => c.perSalesUnit?.unit ?? "none"));
  const perContent = dims.size === 1 && !dims.has("none");
  const comparable = (c: RankCandidate) =>
    perContent ? c.unitPriceExclVat! / c.perSalesUnit!.value : c.unitPriceExclVat!;
  const cheapest = Math.min(...pool.map(comparable));
  const known = (v: (c: RankCandidate) => number | null) => pool.map(v).filter((x): x is number => x !== null);
  const bestCo2 = Math.min(...known((c) => c.co2PerKg));
  const origins = lower(prefs.preferredOriginCountries);
  const vendors = lower(prefs.preferredVendors);
  const brands = lower(prefs.preferredBrands);

  const scored: RankedCandidate[] = pool.map((c) => {
    const reasons: string[] = [];
    const price = comparable(c);
    const unitLabel = perContent ? `/${c.perSalesUnit!.unit}` : `/${c.salesUnit}`;
    const priceScore = price > 0 ? cheapest / price : 1;
    reasons.push(
      priceScore >= 0.999
        ? `${eur(price)}${unitLabel}, cheapest`
        : `${eur(price)}${unitLabel}, ${Math.round((price / cheapest - 1) * 100)}% above the cheapest`,
    );

    const earliest = c.availableDate?.slice(0, 10) ?? null;
    const late = earliest !== null && earliest > prefs.requestedDate;
    const short = c.availableQuantity !== null && c.availableQuantity < c.quantity;
    const availability = late ? 0.3 : short ? 0.5 : 1;
    reasons.push(
      late
        ? `earliest delivery ${earliest}, after ${prefs.requestedDate}`
        : short
          ? `only ${c.availableQuantity} ${c.salesUnit} in stock for ${c.quantity}`
          : `deliverable by ${prefs.requestedDate}${c.availableQuantity === null ? " (stock not reported)" : ""}`,
    );

    const relevance = Math.min(1, c.nameMatch * 0.7 + (c.previouslyOrderedProduct ? 0.3 : c.previouslyOrderedBrand ? 0.15 : 0));
    if (c.previouslyOrderedProduct) reasons.push("ordered before");
    else if (c.previouslyOrderedBrand) reasons.push(`known brand (${c.brand})`);

    const reliability = c.deliveryReliability ?? 0.5;
    if (c.deliveryReliability !== null) reasons.push(`delivery reliability ${Math.round(c.deliveryReliability * 100)}%`);

    const co2 = c.co2PerKg === null || !Number.isFinite(bestCo2) ? 0.5 : c.co2PerKg <= 0 ? 1 : bestCo2 / c.co2PerKg;
    if (c.co2PerKg !== null) reasons.push(`${round(c.co2PerKg)} kg CO2e/kg${co2 >= 0.999 ? " (lowest)" : ""}`);

    const prefHits: string[] = [];
    if (c.countryOfOrigin && origins.has(c.countryOfOrigin.toLowerCase())) prefHits.push(`preferred origin (${c.countryOfOrigin.toUpperCase()})`);
    if (vendors.has(c.vendorName.toLowerCase())) prefHits.push("preferred vendor");
    if (c.brand && brands.has(c.brand.toLowerCase())) prefHits.push("preferred brand");
    const sustainable = c.labels.filter((l) => SUSTAINABILITY_LABELS.has(l));
    if (sustainable.length) prefHits.push(sustainable.map(labelName).join(", "));
    const preferences = Math.min(1, prefHits.length * 0.4);
    reasons.push(...prefHits);

    const factors = { price: priceScore, availability, relevance, reliability, co2, preferences };
    const score = round(
      (Object.keys(RANK_WEIGHTS) as (keyof typeof RANK_WEIGHTS)[]).reduce((s, k) => s + RANK_WEIGHTS[k] * factors[k], 0),
      3,
    );
    return {
      ...c,
      score,
      tier: null,
      lineTotalExclVat: round(c.unitPriceExclVat! * c.quantity),
      pricePerContent: perContent ? { value: round(price, 3), unit: c.perSalesUnit!.unit } : null,
      factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, round(v, 3)])) as RankedCandidate["factors"],
      reasons,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const tiers = ["best", "better", "good"] as const;
  scored.forEach((c, i) => (c.tier = tiers[i] ?? null));
  return { ranked: scored, unavailable };
}
