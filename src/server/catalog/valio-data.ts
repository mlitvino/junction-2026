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
  allergens: string[];
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

function normalize(raw: RawProduct, issues: DataIssue[]): CatalogProduct {
  const names: CatalogProduct["names"] = {};
  for (const n of raw.synkkaData.names) {
    if (n.language === "en" || n.language === "fi" || n.language === "sv") names[n.language] = n.value;
  }
  if (raw.substitutions?.some((s) => s.substituteProduct === raw.id)) {
    issues.push({ file: "products.json", ref: raw.id, problem: "lists itself as its own substitute" });
  }
  const allergens =
    raw.synkkaData.classifications
      .find((c) => c.name === "allergen")
      ?.values.map((v) => v.id) ?? [];

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
