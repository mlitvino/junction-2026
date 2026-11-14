// Parses data/valio/* (pnpm data:fetch first), joins the three files and prints a cross-file report.
// Full report: data/valio/analysis.json.
// Run: pnpm data:analyze  (plain Node with type stripping; --conditions=react-server satisfies "server-only")

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { analyzeCatalog } from "../src/server/catalog/analyze.ts";
import { loadValioCatalog, VALIO_DATA_DIR } from "../src/server/catalog/valio-data.ts";

const started = performance.now();
const catalog = await loadValioCatalog();
const report = analyzeCatalog(catalog);
const out = path.join(VALIO_DATA_DIR, "analysis.json");
await writeFile(out, JSON.stringify(report, null, 2));

const { coverage: c, distributions: d, relationships: r } = report;
const line = (label: string, value: unknown) => console.log(`  ${label.padEnd(34)} ${value}`);
const share = (n: number) => `${n}  (${((n / c.products) * 100).toFixed(1)}%)`;

console.log(`\nValio catalog: parsed and joined in ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
console.log("Coverage");
line("products", c.products);
line("with CO2 footprint", share(c.withCo2));
line("with delivery reliability", share(c.withReliability));
line("with both", share(c.withBoth));
line("with neither", share(c.withNeither));
line("with net weight (→ CO2 per unit)", `${c.withNetWeight} (${c.withCo2PerUnit} with CO2 per unit)`);
line("with substitutes", c.withSubstitutes);

console.log("\nDistributions (min / median / p90 / max)");
const fmt = (s: typeof d.co2PerKg) => (s ? `${s.min} / ${s.median} / ${s.p90} / ${s.max}` : "—");
line("CO2, kg CO2-eq per kg", fmt(d.co2PerKg));
line("CO2, kg CO2-eq per base unit", fmt(d.co2PerBaseUnit));
line("delivery reliability", fmt(d.deliveryReliability));
for (const [band, n] of Object.entries(d.reliabilityBands)) line(`  reliability ${band}`, n);

console.log("\nRelationships");
line("CO2 vs reliability (Pearson r)", r.co2VsReliabilityPearson ?? "—");
const sub = r.substitutions;
line("substitution pairs", sub.pairs);
line("  substitute greener", `${sub.co2PerKg.substituteBetter} of ${sub.co2PerKg.comparable} comparable`);
line("  substitute more reliable", `${sub.deliveryReliability.substituteBetter} of ${sub.deliveryReliability.comparable} comparable`);

console.log("\nLeast reliable products");
for (const p of report.leastReliable.slice(0, 5)) line(`${p.id} ${p.name.slice(0, 30)}`, p.deliveryReliability);
console.log("\nHighest CO2 per kg");
for (const p of report.highestCo2.slice(0, 5)) line(`${p.id} ${p.name.slice(0, 30)}`, p.co2PerKg);

console.log("\nAnomalies (see docs/valio-data-anomalies.md)");
const marker = { error: "✗ ERROR  ", warning: "! WARNING", info: "· info   " } as const;
for (const a of report.anomalies) {
  const examples = a.sample
    .slice(0, 2)
    .map((s) => s.id)
    .join(", ");
  console.log(`  ${marker[a.severity]} ${String(a.count).padStart(5)}  ${a.title}  [e.g. ${examples}]`);
}
for (const n of report.notes) console.log(`  · note     ${n.note}`);

console.log(`\nData issues: ${report.issues.total}`);
for (const [problem, n] of Object.entries(report.issues.byProblem).slice(0, 8)) line(problem.slice(0, 34), n);
console.log(`\nFull report: ${path.relative(process.cwd(), out)}\n`);
