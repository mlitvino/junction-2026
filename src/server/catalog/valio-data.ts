import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

// Parser for the static Valio Aimo challenge files (pnpm data:fetch → data/valio/).
// products.json is the master list; the two CSVs add per-product metrics and are joined by product id.
// Imports use explicit .ts extensions so plain Node can run this too (scripts/analyze-valio-data.ts).

export const VALIO_DATA_DIR = path.resolve(process.cwd(), "data/valio");

// ---------- Raw file schemas (only the fields we use; everything else is dropped) ----------

const LocalizedText = z.object({ value: z.string(), language: z.string() });
const Measure = z.object({ unit: z.string(), value: z.number() });

const RawProduct = z.object({
  id: z.string().min(1),
  salesUnitGtin: z.string().optional(),
  salesUnit: z.string(),
  baseUnit: z.string(),
  category: z.string(),
  allowedLotSize: z.number(),
  deleted: z.boolean(),
  temperatureCondition: z.number().optional(),
  vendorName: z.string(),
  countryOfOrigin: z.string().optional(),
  units: z.array(z.object({ unitId: z.string(), gtin: z.string().optional(), sizeInBaseUnits: z.number() })),
  substitutions: z.array(z.object({ product: z.string(), substituteProduct: z.string() })).optional(),
  // The whole Synkka (GS1 product data pool) block is missing for ~3 000 products, hence optional fields.
  synkkaData: z.object({
    names: z.array(LocalizedText),
    brand: z.string().optional(),
    vatCode: z.string().optional(),
    gtin: z.string().optional(),
    lastUpdated: z.string().optional(),
    countriesOfOrigin: z.array(z.string()).optional(),
    minTemperature: z.number().nullish(),
    maxTemperature: z.number().nullish(),
    variableUnit: z.boolean().optional(),
    medias: z.array(z.unknown()),
    unitConversions: z
      .array(
        z.object({
          synkkaPackagingType: z.string(),
          netWeight: Measure.optional(),
          grossWeight: Measure.optional(),
          /** Net content of this packaging level (LTR, MLT, CLT, KGM, GRM; piece units are ignored). */
          volume: Measure.optional(),
        }),
      )
      .optional(),
    classifications: z.array(
      z.object({ name: z.string(), values: z.array(z.object({ id: z.string() }).loose()) }),
    ),
  }),
});
type RawProduct = z.infer<typeof RawProduct>;

// ---------- Normalized model ----------

export type CatalogProduct = {
  id: string;
  gtin: string | null;
  /** English name, falling back to Finnish, then any language. */
  name: string;
  names: Partial<Record<"en" | "fi" | "sv", string>>;
  brand: string | null;
  vendorName: string;
  category: string;
  salesUnit: string;
  baseUnit: string;
  units: { unitId: string; gtin: string | null; sizeInBaseUnits: number }[];
  allowedLotSize: number;
  temperatureCondition: number | null;
  countryOfOrigin: string | null;
  /** Raw Synkka VAT code (MEDIUM, STANDARD, …); kept as is, see anomalies.ts for malformed values. */
  vatCode: string | null;
  /** GS1 allergen codes the product contains (Synkka `allergen` with unit CONTAINS). */
  allergens: string[];
  /** GS1 allergen codes it may contain (cross-contamination, unit MAY_CONTAIN). */
  mayContainAllergens: string[];
  /** Net content of one base unit, in `contentUnit` (L or KG); null when not declared. */
  contentPerBaseUnit: number | null;
  contentUnit: "L" | "KG" | null;
  /** Per 100 g or ml, from Synkka `nutritionFact`; null when not declared. */
  nutrition: CatalogNutrition | null;
  /** Packaging labels and certificates (Synkka `packagingMarkedLabel`, storage temperatures removed). */
  labels: string[];
  /** Nutritional and free-from claims (e.g. FREE_FROM_LACTOSE, VEGAN, HIGH_PROTEIN). */
  claims: string[];
  /** Dietary tags derived from the claims (and a few name hints): lactose-free, gluten-free, vegan, vegetarian. */
  dietaryTags: string[];
  /** Storage temperature range from Synkka, °C. More specific than temperatureCondition. */
  storageTempC: { min: number | null; max: number | null } | null;
  /** True when the product is priced by weight (Synkka variableUnit). */
  variableWeight: boolean | null;
  /** GTIN Synkka describes; may be a different packaging level than the sales unit. */
  synkkaGtin: string | null;
  /** Countries of origin from Synkka, as ISO alpha-2 (lowercase, like countryOfOrigin); unknown codes kept raw. */
  synkkaCountries: string[];
  /** When the Synkka record was last updated (ISO string), null without Synkka data. */
  synkkaLastUpdated: string | null;
  hasImage: boolean;
  /** Net weight of one base unit in kg, when Synkka declares it in a weight unit. */
  netWeightKg: number | null;
  substitutes: string[];
  /** From carbon-footprint.csv: average kg CO2-eq per kg of product. */
  co2PerKg: number | null;
  /** co2PerKg × netWeightKg: kg CO2-eq for one base unit. */
  co2PerBaseUnit: number | null;
  /** From delivery-reliability.csv: share of deliveries delivered as ordered, 0–1. */
  deliveryReliability: number | null;
};

export type CatalogNutrition = {
  energyKcal: number | null;
  fat: number | null;
  saturatedFat: number | null;
  carbohydrate: number | null;
  sugars: number | null;
  protein: number | null;
  salt: number | null;
  fibre: number | null;
};

export type DataIssue = { file: string; ref: string; problem: string };

export type ValioCatalog = {
  products: Map<string, CatalogProduct>;
  /** Rows that failed validation or could not be joined. Parsing never throws on bad rows. */
  issues: DataIssue[];
};

// ---------- Parsing ----------

// ISO 3166 numeric → alpha-2 for every code present in the Synkka data. "097" (EU) and "NON_EU" are
// GS1 groupings, not countries, so they stay raw and never match an ERP country.
const ISO_NUMERIC_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  (
    "246fi 276de 752se 380it 528nl 250fr 156cn 616pl 208dk 056be 724es 233ee 826gb 300gr 040at 764th " +
    "840us 428lv 440lt 642ro 703sk 578no 356in 203cz 348hu 360id 792tr 608ph 756ch 484mx 704vn 604pe " +
    "818eg 076br 144lk 196cy 620pt 100bg 554nz 372ie 036au 392jp 710za 158tw 320gt 804ua 458my 688rs " +
    "705si 124ca 191hr 442lu 188cr 218ec 410kr 504ma 032ar 388jm 450mg 784ae 364ir 152cl 854bf 068bo " +
    "340hn 404ke 422lb 454mw 600py 222sv 304gl 480mu 566ng 586pk 643ru 716zw 760sy 012dz 174km 192cu " +
    "352is 398kz 788tn 170co 231et 248ax 288gh 332ht 376il 384ci 562ne 624gw 690sc 702sg 768tg 800ug " +
    "807mk 008al 050bd 031az"
  )
    .split(" ")
    .map((s) => [s.slice(0, 3), s.slice(3)]),
);

const WEIGHT_TO_KG: Record<string, number> = { KGM: 1, GRM: 0.001, MGM: 0.000001 };
const toKg = (m: { unit: string; value: number } | undefined) => {
  const factor = m && WEIGHT_TO_KG[m.unit];
  return m && factor ? m.value * factor : null;
};

/**
 * Net weight of one base unit in kg. Synkka data has typos where grams were entered with the KGM unit
 * (e.g. "Pizzatopping 2kg" → 2000 KGM), which would inflate CO2 per unit 1000×. We don't guess the fix:
 * implausible weights are dropped and reported as issues.
 */
function netWeightKg(raw: RawProduct, issues: DataIssue[]): number | null {
  const base = raw.synkkaData.unitConversions?.find(
    (u) => u.synkkaPackagingType === "BASE_UNIT_OR_EACH",
  );
  const net = toKg(base?.netWeight);
  if (net === null || net <= 0) return null;

  const gross = toKg(base?.grossWeight);
  const reject = (problem: string) => {
    issues.push({ file: "products.json", ref: raw.id, problem });
    return null;
  };
  if (gross !== null && net > gross * 1.05) {
    return reject(`net weight ${net} kg exceeds gross weight ${gross} kg (unit typo?)`);
  }
  if (base?.netWeight?.unit === "KGM" && net >= 100) {
    return reject(`net weight ${net} KGM is implausible for one base unit (grams entered as kg?)`);
  }
  return net;
}

const CONTENT_UNITS: Record<string, { unit: "L" | "KG"; factor: number }> = {
  LTR: { unit: "L", factor: 1 },
  DLT: { unit: "L", factor: 0.1 },
  CLT: { unit: "L", factor: 0.01 },
  MLT: { unit: "L", factor: 0.001 },
  KGM: { unit: "KG", factor: 1 },
  GRM: { unit: "KG", factor: 0.001 },
};

/**
 * Net content of one base unit (e.g. 1 L per carton). From the base unit's declared content, or the
 * case content divided by the case size. Piece units (H87) and unknown units give null.
 */
const NAME_UNITS: Record<string, { unit: "L" | "KG"; factor: number }> = {
  l: { unit: "L", factor: 1 },
  dl: { unit: "L", factor: 0.1 },
  cl: { unit: "L", factor: 0.01 },
  ml: { unit: "L", factor: 0.001 },
  kg: { unit: "KG", factor: 1 },
  g: { unit: "KG", factor: 0.001 },
};
const AMOUNT = String.raw`(\d+(?:[.,]\d+)?)\s*(l|dl|cl|ml|kg|g)(?![a-zåäö])`;

/**
 * Net content per base unit read from the product name, for products whose data declares none.
 * Conservative on purpose (a wrong content orders a wrong amount): only a name with exactly one
 * amount and no multipack marker counts ("milk drink 1 l" → 1 L, "cream 3,3 dl" → 0.33 L).
 * Multipacks ("12 x … 1 L", "10x2x85g") and names with several amounts ("18 KG 1CL") stay unknown,
 * so the proposal keeps its "check the quantity" warning.
 */
export function contentFromName(name: string): { value: number; unit: "L" | "KG" } | null {
  const lower = name.toLowerCase();
  if (/\d\s*[x×]\s*\d|\d+\s*[x×]\s/.test(lower)) return null;
  const amounts = [...lower.matchAll(new RegExp(AMOUNT, "g"))];
  if (amounts.length !== 1) return null;
  const [, value, unit] = amounts[0]!;
  const u = NAME_UNITS[unit!]!;
  const content = Math.round(Number.parseFloat(value!.replace(",", ".")) * u.factor * 1e6) / 1e6;
  return content > 0 ? { value: content, unit: u.unit } : null;
}

function contentPerBaseUnit(raw: RawProduct, name: string, issues: DataIssue[]): { value: number; unit: "L" | "KG" } | null {
  const conversions = raw.synkkaData.unitConversions ?? [];
  const base = conversions.find((u) => u.synkkaPackagingType === "BASE_UNIT_OR_EACH" && u.volume);
  const of = (m: { unit: string; value: number } | undefined) => {
    const known = m && CONTENT_UNITS[m.unit.trim()];
    return known && m.value > 0 ? { value: m.value * known.factor, unit: known.unit } : null;
  };
  let content = of(base?.volume);
  if (!content) {
    const kase = conversions.find((u) => u.synkkaPackagingType === "CASE" && u.volume);
    const caseSize = raw.units.find((u) => u.unitId === "KI")?.sizeInBaseUnits;
    const caseContent = of(kase?.volume);
    if (caseContent && caseSize && caseSize > 0) content = { value: caseContent.value / caseSize, unit: caseContent.unit };
  }
  // Products sold by weight or volume (base unit KG, L…) have no "content per unit" to read.
  if (!content && !/^(KG|KGM|G|GRM|L|LTR|DL|ML)$/i.test(raw.baseUnit.trim())) {
    content = contentFromName(name);
    if (content)
      issues.push({ file: "products.json", ref: raw.id, problem: `no declared content; ${content.value} ${content.unit} per base unit read from the name` });
  }
  if (content && content.value >= 1000) {
    issues.push({ file: "products.json", ref: raw.id, problem: `content ${content.value} ${content.unit} per base unit is implausible` });
    return null;
  }
  return content;
}

const NUTRIENTS: Record<string, keyof CatalogNutrition> = {
  "ENER-E14": "energyKcal",
  FAT: "fat",
  FASAT: "saturatedFat",
  CHOAVL: "carbohydrate",
  "SUGAR-": "sugars",
  "PRO-": "protein",
  SALTEQ: "salt",
  FIBTG: "fibre",
};

function nutrition(raw: RawProduct): CatalogNutrition | null {
  const facts = raw.synkkaData.classifications.find((c) => c.name === "nutritionFact")?.values ?? [];
  const out: CatalogNutrition = {
    energyKcal: null, fat: null, saturatedFat: null, carbohydrate: null, sugars: null, protein: null, salt: null, fibre: null,
  };
  let any = false;
  for (const v of facts) {
    const key = NUTRIENTS[v.id];
    const value = typeof v.value === "number" ? v.value : null;
    const unit = typeof v.unit === "string" ? v.unit : null;
    if (!key || value === null) continue;
    if (key === "energyKcal" ? unit !== "E14" : unit !== "GRM") continue; // skip odd units (e.g. FAT in KJO)
    out[key] = value;
    any = true;
  }
  return any ? out : null;
}

const classification = (raw: RawProduct, name: string) =>
  raw.synkkaData.classifications.find((c) => c.name === name)?.values ?? [];

/** Dietary tags from declared claims; name hints only add, never contradict a claim. */
function dietaryTags(claims: string[], names: string): string[] {
  const tags = new Set<string>();
  const has = (c: string) => claims.includes(c);
  if (has("FREE_FROM_LACTOSE") || /\b(lactose[- ]free|laktoositon)\b/i.test(names)) tags.add("lactose-free");
  if (has("FREE_FROM_GLUTEN") || /\b(gluten[- ]?free|gluteeniton)\b/i.test(names)) tags.add("gluten-free");
  if (has("VEGAN") || /\b(vegan|vegaan)/i.test(names)) tags.add("vegan");
  if (has("VEGAN") || has("VEGETARIAN") || tags.has("vegan")) tags.add("vegetarian");
  return [...tags];
}

function normalize(raw: RawProduct, issues: DataIssue[]): CatalogProduct {
  const names: CatalogProduct["names"] = {};
  for (const n of raw.synkkaData.names) {
    if (n.language === "en" || n.language === "fi" || n.language === "sv") names[n.language] = n.value;
  }
  if (raw.substitutions?.some((s) => s.substituteProduct === raw.id)) {
    issues.push({ file: "products.json", ref: raw.id, problem: "lists itself as its own substitute" });
  }
  // Allergens carry a qualifier: CONTAINS, MAY_CONTAIN (cross-contamination) or UNDECLARED.
  const allergenValues = classification(raw, "allergen");
  const allergens = allergenValues.filter((v) => v.unit === "CONTAINS" || v.unit === undefined).map((v) => v.id);
  const mayContainAllergens = allergenValues.filter((v) => v.unit === "MAY_CONTAIN").map((v) => v.id);
  const claims = [
    ...classification(raw, "nutritionalClaim").map((v) => v.id),
    ...classification(raw, "nonAllergen")
      .filter((v) => v.unit === "FREE_FROM")
      .map((v) => `FREE_FROM_${v.id}`),
  ];
  const labels = classification(raw, "packagingMarkedLabel")
    .map((v) => v.id)
    .filter((id) => !/Temperature$/.test(id));
  const displayName = names.en ?? names.fi ?? raw.synkkaData.names[0]?.value ?? raw.id;
  const content = contentPerBaseUnit(raw, displayName, issues);

  return {
    id: raw.id,
    gtin: raw.salesUnitGtin ?? null,
    name: names.en ?? names.fi ?? raw.synkkaData.names[0]?.value ?? raw.id,
    names,
    brand: raw.synkkaData.brand ?? null,
    vendorName: raw.vendorName,
    category: raw.category,
    salesUnit: raw.salesUnit,
    baseUnit: raw.baseUnit,
    units: raw.units.map((u) => ({ ...u, gtin: u.gtin ?? null })),
    allowedLotSize: raw.allowedLotSize,
    temperatureCondition: raw.temperatureCondition ?? null,
    countryOfOrigin: raw.countryOfOrigin ?? null,
    vatCode: raw.synkkaData.vatCode ?? null,
    allergens,
    mayContainAllergens,
    contentPerBaseUnit: content?.value ?? null,
    contentUnit: content?.unit ?? null,
    nutrition: nutrition(raw),
    labels: [...new Set(labels)],
    claims: [...new Set(claims)],
    dietaryTags: dietaryTags(claims, Object.values(names).join(" ")),
    storageTempC:
      raw.synkkaData.minTemperature == null && raw.synkkaData.maxTemperature == null
        ? null
        : { min: raw.synkkaData.minTemperature ?? null, max: raw.synkkaData.maxTemperature ?? null },
    variableWeight: raw.synkkaData.variableUnit ?? null,
    synkkaGtin: raw.synkkaData.gtin ?? null,
    synkkaCountries: (raw.synkkaData.countriesOfOrigin ?? []).map((c) => ISO_NUMERIC_TO_ALPHA2[c] ?? c),
    synkkaLastUpdated: raw.synkkaData.lastUpdated ?? null,
    hasImage: raw.synkkaData.medias.length > 0,
    netWeightKg: netWeightKg(raw, issues),
    substitutes: (raw.substitutions ?? [])
      .map((s) => s.substituteProduct)
      .filter((id) => id !== raw.id),
    co2PerKg: null,
    co2PerBaseUnit: null,
    deliveryReliability: null,
  };
}

export function parseProducts(json: unknown, issues: DataIssue[]): Map<string, CatalogProduct> {
  const file = "products.json";
  const products = new Map<string, CatalogProduct>();
  if (!Array.isArray(json)) {
    issues.push({ file, ref: "(root)", problem: "expected a JSON array" });
    return products;
  }
  json.forEach((item, index) => {
    const parsed = RawProduct.safeParse(item);
    const ref = (item as { id?: unknown })?.id?.toString() ?? `#${index}`;
    if (!parsed.success) {
      issues.push({ file, ref, problem: z.prettifyError(parsed.error).replace(/\n/g, " ") });
    } else if (parsed.data.deleted) {
      issues.push({ file, ref, problem: "marked deleted, skipped" });
    } else if (products.has(parsed.data.id)) {
      issues.push({ file, ref, problem: "duplicate id, kept the first" });
    } else {
      products.set(parsed.data.id, normalize(parsed.data, issues));
    }
  });
  return products;
}

/** Parses a two-column `productId,<number>` CSV. Checks the header so a changed file fails loudly. */
export function parseMetricCsv(
  text: string,
  file: string,
  expectedHeader: string,
  issues: DataIssue[],
  range: { min: number; max: number },
): Map<string, number> {
  const rows = new Map<string, number>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines[0]?.trim();
  if (header !== expectedHeader) {
    issues.push({ file, ref: "header", problem: `expected "${expectedHeader}", got "${header}"` });
    return rows;
  }
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return;
    const [id, rawValue, ...rest] = line.split(",").map((s) => s.trim());
    const ref = id || `line ${i + 2}`;
    const value = Number(rawValue);
    if (!id || rest.length > 0 || rawValue === "" || !Number.isFinite(value)) {
      issues.push({ file, ref, problem: `malformed row: "${line}"` });
    } else if (value < range.min || value > range.max) {
      issues.push({ file, ref, problem: `value ${value} outside ${range.min}–${range.max}` });
    } else if (rows.has(id)) {
      issues.push({ file, ref, problem: "duplicate id, kept the first" });
    } else {
      rows.set(id, value);
    }
  });
  return rows;
}

/** Joins the parsed files: CSV metrics are attached to products; unknown ids become issues. */
export function joinCatalog(
  products: Map<string, CatalogProduct>,
  co2: Map<string, number>,
  reliability: Map<string, number>,
  issues: DataIssue[],
): ValioCatalog {
  for (const [id, value] of co2) {
    const p = products.get(id);
    if (!p) {
      issues.push({ file: "carbon-footprint.csv", ref: id, problem: "no such product" });
      continue;
    }
    p.co2PerKg = value;
    p.co2PerBaseUnit = p.netWeightKg === null ? null : value * p.netWeightKg;
  }
  for (const [id, value] of reliability) {
    const p = products.get(id);
    if (p) p.deliveryReliability = value;
    else issues.push({ file: "delivery-reliability.csv", ref: id, problem: "no such product" });
  }
  for (const p of products.values()) {
    for (const s of p.substitutes) {
      if (!products.has(s)) {
        issues.push({ file: "products.json", ref: p.id, problem: `substitute ${s} is not in the catalog` });
      }
    }
  }
  return { products, issues };
}

/** Reads and joins all three files from `dir` (default data/valio). */
export async function loadValioCatalog(dir: string = VALIO_DATA_DIR): Promise<ValioCatalog> {
  const issues: DataIssue[] = [];
  const read = (name: string) => readFile(path.join(dir, name), "utf8");
  const [productsText, co2Text, reliabilityText] = await Promise.all([
    read("products.json"),
    read("carbon-footprint.csv"),
    read("delivery-reliability.csv"),
  ]);

  const products = parseProducts(JSON.parse(productsText), issues);
  const co2 = parseMetricCsv(co2Text, "carbon-footprint.csv", "productId,AVG kg CO2-eq/kg", issues, {
    min: 0,
    max: 1000,
  });
  const reliability = parseMetricCsv(
    reliabilityText,
    "delivery-reliability.csv",
    "productId,deliveryReliability",
    issues,
    { min: 0, max: 1 },
  );
  return joinCatalog(products, co2, reliability, issues);
}
