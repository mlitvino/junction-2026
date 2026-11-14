import "server-only";

import type { CatalogProduct, ValioCatalog } from "./valio-data.ts";

// Rule-based checks for suspicious values in the joined Valio catalog.
// severity: "error"   = contradictory or impossible data that can mislead ordering or logistics
//           "warning" = likely wrong, needs a human look
//           "info"    = looks odd but has a known, benign explanation (documented so nobody "fixes" it)
// Findings and what they mean for the agent: docs/valio-data-anomalies.md.

export type Severity = "error" | "warning" | "info";

type Context = {
  catalog: ValioCatalog;
  /** Product ids whose net weight the parser rejected (see netWeightKg in valio-data.ts). */
  rejectedWeight: Map<string, string>;
  selfSubstitutes: Set<string>;
  /** "vendor|name" → number of product ids sharing it. */
  listingCounts: Map<string, number>;
  /** Normalized sales-unit GTIN → product ids carrying it. */
  salesGtinOwners: Map<string, string[]>;
  /** Normalized Synkka GTIN → product ids describing it (one consumer item in several packs). */
  synkkaGtinOwners: Map<string, string[]>;
  /** Newest Synkka lastUpdated in the catalog, used as "now" for staleness (the snapshot date). */
  snapshotTime: number;
};

type Rule = {
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
  /** Returns a short detail string when the product matches, otherwise null. */
  test: (p: CatalogProduct, ctx: Context) => string | null;
};

// temperatureCondition codes, inferred from product names and Synkka storage ranges:
// 1–4 chilled (fresh produce, dairy, meat), 7 frozen, 8 ambient/dry. 5, 6, 9 are rare (< 20 products each).
const CHILLED = new Set([1, 2, 3, 4]);
const FROZEN = 7;
const AMBIENT = 8;
/** A chilled product whose declared max storage temperature reaches this is effectively ambient. */
const CHILLED_MAX_PLAUSIBLE_C = 15;

const VALID_VAT_CODES = new Set(["STANDARD", "MEDIUM", "LOW", "NOT_APPLICABLE"]);

/** GS1 prefixes 20–29 are "restricted circulation" codes (in-store, variable-weight items). */
const isRestrictedGtin = (gtin: string) => /^2\d/.test(gtin);

function hasValidGtinChecksum(gtin: string): boolean {
  if (!/^\d{8,14}$/.test(gtin)) return false;
  const digits = gtin.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** GTIN-12 (UPC) and GTIN-13/14 spellings of one code differ only by leading zeros. */
const normGtin = (gtin: string) => gtin.replace(/^0+/, "");

const range = (p: CatalogProduct) => `${p.storageTempC?.min ?? "?"}..${p.storageTempC?.max ?? "?"} °C`;
const listingKey = (p: CatalogProduct) => `${p.vendorName}|${p.name.trim().toLowerCase()}`;
const YEAR_MS = 365 * 24 * 3600 * 1000;

const RULES: Rule[] = [
  // ---------- errors ----------
  {
    id: "temp-ambient-but-frozen",
    severity: "error",
    title: "Ambient temperature condition, but stored frozen",
    explanation:
      "temperatureCondition is 8 (ambient) while Synkka says store at or below 0 °C. Shipping these as ambient would thaw them.",
    test: (p) =>
      p.temperatureCondition === AMBIENT && p.storageTempC?.max != null && p.storageTempC.max <= 0
        ? range(p)
        : null,
  },
  {
    id: "temp-frozen-but-warm",
    severity: "error",
    title: "Frozen temperature condition, but storage range above 0 °C",
    explanation: "temperatureCondition is 7 (frozen) while Synkka allows storage above 0 °C.",
    test: (p) =>
      p.temperatureCondition === FROZEN && p.storageTempC?.max != null && p.storageTempC.max > 0
        ? range(p)
        : null,
  },
  {
    id: "temp-chilled-but-warm",
    severity: "error",
    title: "Chilled temperature condition, but room-temperature storage",
    explanation: `temperatureCondition is 1–4 (chilled) while Synkka allows storage at ${CHILLED_MAX_PLAUSIBLE_C} °C or more.`,
    test: (p) =>
      p.temperatureCondition !== null &&
      CHILLED.has(p.temperatureCondition) &&
      p.storageTempC?.max != null &&
      p.storageTempC.max >= CHILLED_MAX_PLAUSIBLE_C
        ? range(p)
        : null,
  },
  {
    id: "net-weight-typo",
    severity: "error",
    title: "Net weight unit typo (dropped by the parser)",
    explanation:
      "Grams entered with the KGM unit, or net weight above gross weight. netWeightKg and CO2 per unit are null for these.",
    test: (p, ctx) => ctx.rejectedWeight.get(p.id) ?? null,
  },
  {
    id: "unit-zero-size",
    severity: "error",
    title: "Packaging unit with zero size",
    explanation: "A unit with sizeInBaseUnits ≤ 0 cannot be ordered or converted.",
    test: (p) => {
      const bad = p.units.filter((u) => !(u.sizeInBaseUnits > 0)).map((u) => u.unitId);
      return bad.length ? `units ${bad.join(", ")}` : null;
    },
  },
  {
    id: "self-substitute",
    severity: "error",
    title: "Product is listed as its own substitute",
    explanation: "Substitution points back to the same product id (removed from substitutes by the parser).",
    test: (p, ctx) => (ctx.selfSubstitutes.has(p.id) ? "substitute = itself" : null),
  },

  // ---------- warnings ----------
  {
    id: "vat-code-malformed",
    severity: "warning",
    title: "Malformed VAT code",
    explanation: `VAT code is empty or not one of ${[...VALID_VAT_CODES].join(", ")} (e.g. duplicated "MEDIUM MEDIUM").`,
    test: (p) => (p.vatCode !== null && !VALID_VAT_CODES.has(p.vatCode) ? JSON.stringify(p.vatCode) : null),
  },
  {
    id: "gtin-unrelated",
    severity: "info",
    title: "Synkka GTIN matches no packaging unit of the product",
    explanation:
      "Synkka describes a GTIN that is none of this product's units. Usually the consumer item inside a multipack (e.g. 325 × sugar 1 kg), sometimes a different variant: treat Synkka weight and temperatures with care.",
    test: (p) => {
      if (!p.synkkaGtin || !p.gtin) return null;
      const synkka = normGtin(p.synkkaGtin);
      const known = [p.gtin, ...p.units.map((u) => u.gtin)].filter((g): g is string => !!g).map(normGtin);
      return known.includes(synkka) ? null : `sales ${p.gtin}, synkka ${p.synkkaGtin}`;
    },
  },
  {
    id: "sales-gtin-shared",
    severity: "warning",
    title: "Same sales GTIN on several product ids",
    explanation: "A GTIN identifies one trade item, so two product ids selling it are likely a duplicate listing.",
    test: (p, ctx) => {
      const others = p.gtin ? (ctx.salesGtinOwners.get(normGtin(p.gtin)) ?? []).filter((id) => id !== p.id) : [];
      return others.length ? `also on ${others.join(", ")}` : null;
    },
  },
  {
    id: "country-mismatch",
    severity: "warning",
    title: "Country of origin differs between ERP and Synkka",
    explanation:
      "ERP countryOfOrigin disagrees with the single country Synkka declares. Matters for origin-based filters (e.g. Finnish only).",
    test: (p) => {
      const [only, ...rest] = p.synkkaCountries;
      return only && rest.length === 0 && only.length === 2 && p.countryOfOrigin && only !== p.countryOfOrigin
        ? `ERP ${p.countryOfOrigin}, Synkka ${only}`
        : null;
    },
  },
  {
    id: "reliability-zero",
    severity: "warning",
    title: "Delivery reliability is exactly 0",
    explanation: "Never delivered as ordered. Either truly undeliverable or a placeholder value; avoid without a substitute.",
    test: (p) => (p.deliveryReliability === 0 ? "reliability 0" : null),
  },
  {
    id: "variable-weight-unit-mismatch",
    severity: "warning",
    title: "Weight-priced flag contradicts the sales unit",
    explanation: "Synkka variableUnit says priced by weight but the sales unit is not KG, or the other way round.",
    test: (p) =>
      (p.variableWeight === true && p.salesUnit !== "KG") || (p.variableWeight === false && p.salesUnit === "KG")
        ? `variableUnit ${p.variableWeight}, salesUnit ${p.salesUnit}`
        : null,
  },
  {
    id: "gtin-bad-checksum",
    severity: "warning",
    title: "GTIN with invalid check digit",
    explanation: "A regular (non in-store) GTIN whose check digit is wrong: likely a typo.",
    test: (p) =>
      p.gtin && !isRestrictedGtin(p.gtin) && !hasValidGtinChecksum(p.gtin) ? p.gtin : null,
  },

  // ---------- info ----------
  {
    id: "gtin-restricted-circulation",
    severity: "info",
    title: "In-store GTIN (prefix 20–29) without a standard check digit",
    explanation:
      "Restricted-circulation codes for variable-weight fresh produce. Not a global GTIN; don't validate or look them up as one.",
    test: (p) => (p.gtin && isRestrictedGtin(p.gtin) && !hasValidGtinChecksum(p.gtin) ? p.gtin : null),
  },
  {
    id: "substitute-different-temperature",
    severity: "info",
    title: "Substitute has a different temperature condition",
    explanation: "Usually fine (e.g. Finnish vs Dutch cucumber), but check before swapping chilled ↔ frozen.",
    test: (p, ctx) => {
      const diff = p.substitutes
        .map((id) => ctx.catalog.products.get(id))
        .filter((s) => s && s.temperatureCondition !== p.temperatureCondition)
        .map((s) => `${s!.id} (${s!.temperatureCondition})`);
      return diff.length ? `${p.temperatureCondition} → ${diff.join(", ")}` : null;
    },
  },
  {
    id: "same-item-other-pack",
    severity: "info",
    title: "Same consumer item sold in other pack sizes",
    explanation:
      "Several product ids describe one Synkka GTIN (e.g. sugar 1 kg as 10× and 325×). Useful as pack-size alternatives, not duplicates.",
    test: (p, ctx) => {
      const others = p.synkkaGtin
        ? (ctx.synkkaGtinOwners.get(normGtin(p.synkkaGtin)) ?? []).filter((id) => id !== p.id)
        : [];
      return others.length ? `also as ${others.join(", ")}` : null;
    },
  },
  {
    id: "same-name-different-item",
    severity: "info",
    title: "Same name and vendor on several product ids",
    explanation:
      "Different GTINs and packaging, so separate items, but indistinguishable by name. The agent must refer to them by id or GTIN and show the pack size.",
    test: (p, ctx) => {
      const n = ctx.listingCounts.get(listingKey(p)) ?? 0;
      return n > 1 ? `${n} ids share this name (sales unit ${p.salesUnit})` : null;
    },
  },
  {
    id: "name-untranslated",
    severity: "info",
    title: "English name is the Finnish name",
    explanation: "No translation (mostly fresh produce in uppercase). English search may miss these.",
    test: (p) => (p.names.en && p.names.en === p.names.fi ? p.names.en : null),
  },
  {
    id: "no-synkka-data",
    severity: "info",
    title: "No Synkka product data",
    explanation: "No GTIN, storage temperatures, VAT code or update date from the GS1 data pool. Only ERP fields are available.",
    test: (p) => (p.synkkaLastUpdated === null ? "no Synkka record" : null),
  },
  {
    id: "synkka-stale",
    severity: "info",
    title: "Synkka record not updated for over a year",
    explanation: "Measured against the newest update in the file (the snapshot date). Details may be outdated.",
    test: (p, ctx) =>
      p.synkkaLastUpdated && ctx.snapshotTime - Date.parse(p.synkkaLastUpdated) > YEAR_MS
        ? p.synkkaLastUpdated.slice(0, 10)
        : null,
  },
  {
    id: "no-image",
    severity: "info",
    title: "No product image",
    explanation: "No media in Synkka; the UI needs a placeholder.",
    test: (p) => (p.hasImage ? null : "no media"),
  },
];

export type AnomalyFinding = {
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
  count: number;
  sample: { id: string; name: string; detail: string }[];
};

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const SAMPLE_SIZE = 10;

function buildContext(catalog: ValioCatalog): Context {
  const rejectedWeight = new Map<string, string>();
  const selfSubstitutes = new Set<string>();
  for (const issue of catalog.issues) {
    if (issue.problem.startsWith("net weight")) rejectedWeight.set(issue.ref, issue.problem);
    if (issue.problem.includes("its own substitute")) selfSubstitutes.add(issue.ref);
  }
  const listingCounts = new Map<string, number>();
  const salesGtinOwners = new Map<string, string[]>();
  const synkkaGtinOwners = new Map<string, string[]>();
  const own = (map: Map<string, string[]>, gtin: string | null, id: string) => {
    if (!gtin) return;
    const key = normGtin(gtin);
    map.set(key, [...(map.get(key) ?? []), id]);
  };
  let snapshotTime = 0;
  for (const p of catalog.products.values()) {
    listingCounts.set(listingKey(p), (listingCounts.get(listingKey(p)) ?? 0) + 1);
    own(salesGtinOwners, p.gtin, p.id);
    own(synkkaGtinOwners, p.synkkaGtin, p.id);
    if (p.synkkaLastUpdated) snapshotTime = Math.max(snapshotTime, Date.parse(p.synkkaLastUpdated));
  }
  return { catalog, rejectedWeight, selfSubstitutes, listingCounts, salesGtinOwners, synkkaGtinOwners, snapshotTime };
}

/** Runs every rule over every product. Rules with no matches are left out. */
export function detectAnomalies(catalog: ValioCatalog): AnomalyFinding[] {
  const ctx = buildContext(catalog);
  const findings: AnomalyFinding[] = [];
  for (const rule of RULES) {
    let count = 0;
    const sample: AnomalyFinding["sample"] = [];
    for (const p of catalog.products.values()) {
      const detail = rule.test(p, ctx);
      if (detail === null) continue;
      count++;
      if (sample.length < SAMPLE_SIZE) sample.push({ id: p.id, name: p.name, detail });
    }
    if (count > 0) {
      const { id, severity, title, explanation } = rule;
      findings.push({ id, severity, title, explanation, count, sample });
    }
  }
  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
}

/** Dataset-level observations that aren't about single products. */
export function datasetNotes(catalog: ValioCatalog) {
  const co2Values = new Set<number>();
  let co2Rows = 0;
  for (const p of catalog.products.values()) {
    if (p.co2PerKg !== null) {
      co2Values.add(p.co2PerKg);
      co2Rows++;
    }
  }
  return [
    {
      id: "co2-is-group-average",
      note: `CO2 footprint has only ${co2Values.size} distinct values across ${co2Rows} products: it is an average per product group, not a per-product measurement. Use it to tell high- from low-carbon kinds of products, not to rank two similar items.`,
    },
  ];
}
