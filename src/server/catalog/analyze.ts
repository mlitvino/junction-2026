import "server-only";

import { datasetNotes, detectAnomalies } from "./anomalies.ts";
import type { CatalogProduct, DataIssue, ValioCatalog } from "./valio-data.ts";

// Cross-file analysis of the joined Valio catalog: how the three files overlap and what the
// combined metrics say. Pure functions over ValioCatalog; output is plain JSON.

type Stats = { count: number; min: number; p10: number; median: number; p90: number; max: number; mean: number };

function stats(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    count: s.length,
    min: round(s[0]!),
    p10: round(at(0.1)),
    median: round(at(0.5)),
    p90: round(at(0.9)),
    max: round(s.at(-1)!),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

/** Pearson correlation; null when fewer than 3 pairs or no variance. */
function pearson(pairs: [number, number][]): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000;
}

const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 1000) / 10);

function groupBy<K extends string>(items: CatalogProduct[], key: (p: CatalogProduct) => K) {
  const groups = new Map<K, CatalogProduct[]>();
  for (const p of items) {
    const k = key(p);
    const list = groups.get(k);
    if (list) list.push(p);
    else groups.set(k, [p]);
  }
  return groups;
}

/** Per-group coverage of the two CSV metrics, largest groups first. */
function coverageBy(items: CatalogProduct[], key: (p: CatalogProduct) => string, limit: number) {
  return [...groupBy(items, key)]
    .map(([group, list]) => ({
      group,
      products: list.length,
      withCo2Pct: pct(list.filter((p) => p.co2PerKg !== null).length, list.length),
      withReliabilityPct: pct(list.filter((p) => p.deliveryReliability !== null).length, list.length),
    }))
    .sort((a, b) => b.products - a.products)
    .slice(0, limit);
}

const brief = (p: CatalogProduct) => ({
  id: p.id,
  name: p.name,
  vendor: p.vendorName,
  category: p.category,
  co2PerKg: p.co2PerKg,
  deliveryReliability: p.deliveryReliability,
});

export function analyzeCatalog(catalog: ValioCatalog) {
  const { products, issues } = catalog;
  const all = [...products.values()];
  const hasCo2 = (p: CatalogProduct) => p.co2PerKg !== null;
  const hasRel = (p: CatalogProduct) => p.deliveryReliability !== null;
  const both = all.filter((p) => hasCo2(p) && hasRel(p));

  // CO2 by category (only categories with enough data to be meaningful).
  const co2ByCategory = [...groupBy(all.filter(hasCo2), (p) => p.category)]
    .filter(([, list]) => list.length >= 5)
    .map(([category, list]) => ({
      category,
      products: list.length,
      medianCo2PerKg: stats(list.map((p) => p.co2PerKg!))!.median,
    }))
    .sort((a, b) => b.medianCo2PerKg - a.medianCo2PerKg);

  // Substitutions: is the suggested substitute greener / more reliable than the original?
  const substitutionPairs = all.flatMap((p) =>
    p.substitutes.flatMap((sid) => {
      const s = products.get(sid);
      return s ? [{ original: p, substitute: s }] : [];
    }),
  );
  const compare = (metric: (p: CatalogProduct) => number | null, lowerIsBetter: boolean) => {
    const comparable = substitutionPairs.filter(
      ({ original, substitute }) => metric(original) !== null && metric(substitute) !== null,
    );
    const better = comparable.filter(({ original, substitute }) =>
      lowerIsBetter ? metric(substitute)! < metric(original)! : metric(substitute)! > metric(original)!,
    ).length;
    const same = comparable.filter(({ original, substitute }) => metric(substitute) === metric(original)).length;
    return { comparable: comparable.length, substituteBetter: better, same, substituteWorse: comparable.length - better - same };
  };

  const issuesByProblem = new Map<string, number>();
  for (const i of issues) {
    const key = `${i.file}: ${i.problem.replace(/\d+(\.\d+)?/g, "N").slice(0, 80)}`;
    issuesByProblem.set(key, (issuesByProblem.get(key) ?? 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    coverage: {
      products: all.length,
      withCo2: all.filter(hasCo2).length,
      withReliability: all.filter(hasRel).length,
      withBoth: both.length,
      withNeither: all.filter((p) => !hasCo2(p) && !hasRel(p)).length,
      co2OnlyPct: pct(all.filter((p) => hasCo2(p) && !hasRel(p)).length, all.length),
      reliabilityOnlyPct: pct(all.filter((p) => !hasCo2(p) && hasRel(p)).length, all.length),
      withNetWeight: all.filter((p) => p.netWeightKg !== null).length,
      withCo2PerUnit: all.filter((p) => p.co2PerBaseUnit !== null).length,
      withSubstitutes: all.filter((p) => p.substitutes.length > 0).length,
    },
    distributions: {
      co2PerKg: stats(all.filter(hasCo2).map((p) => p.co2PerKg!)),
      co2PerBaseUnit: stats(all.flatMap((p) => (p.co2PerBaseUnit === null ? [] : [p.co2PerBaseUnit]))),
      deliveryReliability: stats(all.filter(hasRel).map((p) => p.deliveryReliability!)),
      reliabilityBands: {
        perfect: all.filter((p) => p.deliveryReliability === 1).length,
        "0.99–<1": all.filter((p) => hasRel(p) && p.deliveryReliability! >= 0.99 && p.deliveryReliability! < 1).length,
        "0.95–<0.99": all.filter((p) => hasRel(p) && p.deliveryReliability! >= 0.95 && p.deliveryReliability! < 0.99).length,
        "0.90–<0.95": all.filter((p) => hasRel(p) && p.deliveryReliability! >= 0.9 && p.deliveryReliability! < 0.95).length,
        "<0.90": all.filter((p) => hasRel(p) && p.deliveryReliability! < 0.9).length,
      },
    },
    relationships: {
      /** Do high-CO2 products deliver worse (or better)? Near 0 = no linear relation. */
      co2VsReliabilityPearson: pearson(both.map((p) => [p.co2PerKg!, p.deliveryReliability!])),
      substitutions: {
        pairs: substitutionPairs.length,
        co2PerKg: compare((p) => p.co2PerKg, true),
        deliveryReliability: compare((p) => p.deliveryReliability, false),
      },
    },
    coverageByTemperatureCondition: coverageBy(all, (p) => String(p.temperatureCondition ?? "none"), 20),
    coverageByVendor: coverageBy(all, (p) => p.vendorName, 15),
    co2ByCategory: { highest: co2ByCategory.slice(0, 10), lowest: co2ByCategory.slice(-10).reverse() },
    leastReliable: all
      .filter(hasRel)
      .sort((a, b) => a.deliveryReliability! - b.deliveryReliability!)
      .slice(0, 15)
      .map(brief),
    highestCo2: all
      .filter(hasCo2)
      .sort((a, b) => b.co2PerKg! - a.co2PerKg!)
      .slice(0, 15)
      .map(brief),
    anomalies: detectAnomalies(catalog),
    notes: datasetNotes(catalog),
    issues: {
      total: issues.length,
      byProblem: Object.fromEntries([...issuesByProblem].sort((a, b) => b[1] - a[1])),
      sample: issues.slice(0, 20) satisfies DataIssue[],
    },
  };
}

export type CatalogAnalysis = ReturnType<typeof analyzeCatalog>;
