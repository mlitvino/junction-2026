// Downloads the static Valio Aimo challenge files (see docs/valio-aimo-openapi.json) into data/valio/.
// Run: pnpm data:fetch  (reads VALIO_API_URL and VALIO_API_KEY from .env)
// The files don't change during the challenge, so this only needs to run once.
// --if-missing: skip the download when all files are already there (used by pnpm bootstrap).

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FILES = [
  { endpoint: "/api/products/download", out: "products.json" },
  { endpoint: "/api/delivery-reliability/download", out: "delivery-reliability.csv" },
  { endpoint: "/api/carbon-footprint/download", out: "carbon-footprint.csv" },
];
const OUT_DIR = path.resolve("data/valio");

if (process.argv.includes("--if-missing") && FILES.every(({ out }) => existsSync(path.join(OUT_DIR, out)))) {
  console.log(`Valio files already in ${path.relative(process.cwd(), OUT_DIR)}/, skipping download.`);
  process.exit(0);
}

// The endpoints already start with /api, so keep only the server origin: people often paste
// the docs or spec URL (https://host/docs, https://host/api, https://host/openapi.json).
const baseUrl = process.env.VALIO_API_URL?.trim()
  .replace(/\/+$/, "")
  .replace(/\/(docs|redoc|openapi\.json|api)$/i, "");
const apiKey = process.env.VALIO_API_KEY?.trim();
if (!baseUrl || !apiKey) {
  console.error("Set VALIO_API_URL and VALIO_API_KEY in .env (see .env.example).");
  process.exit(1);
}

/**
 * The download endpoints answer with a redirect to the actual file (often a signed storage URL).
 * Follow it by hand so the API key is sent only to the Valio API, never to the redirect target.
 */
async function download(endpoint) {
  const res = await fetch(baseUrl + endpoint, {
    headers: { "X-API-Key": apiKey },
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) throw new Error(`${endpoint}: redirect without Location header`);
    const file = await fetch(new URL(location, baseUrl));
    if (!file.ok) throw new Error(`${endpoint}: file download failed with HTTP ${file.status}`);
    return Buffer.from(await file.arrayBuffer());
  }
  if (!res.ok) throw new Error(`GET ${baseUrl + endpoint}: HTTP ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

await mkdir(OUT_DIR, { recursive: true });
let failed = false;
for (const { endpoint, out } of FILES) {
  try {
    const body = await download(endpoint);
    await writeFile(path.join(OUT_DIR, out), body);
    console.log(`✓ ${out} (${(body.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    failed = true;
    console.error(`✗ ${out}: ${err instanceof Error ? err.message : err}`);
  }
}
process.exit(failed ? 1 : 0);
