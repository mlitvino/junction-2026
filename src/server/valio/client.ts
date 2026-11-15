import "server-only";

import {
  VALIO_UNKNOWN_AMOUNT,
  ValioAvailabilityResponse,
  ValioPriceResponse,
  type ValioProductAvailability,
  type ValioProductPrice,
  type ValioProductsRequest,
} from "./api-schemas.ts";

// Client for the live Valio Aimo API (/api/price, /api/availability).
// Mock mode: without VALIO_API_KEY it returns deterministic fake data (source "mock"), so CI,
// builds and frontend work need no key. Never call this for the whole catalog: rate limits apply.

export type ValioSource = "valio" | "mock";

export class ValioApiError extends Error {
  // Plain field, not a constructor parameter property: Node's type stripping (scripts/*.ts) can't run those.
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ValioApiError";
    this.status = status;
  }
}

/** Upstream limit per request (HTTP 422 above it). */
const MAX_PRODUCTS_PER_REQUEST = 1000;
const TIMEOUT_MS = 10_000;

function config() {
  const apiKey = process.env.VALIO_API_KEY?.trim();
  // Keep only the origin: the endpoints already start with /api (same rule as scripts/fetch-valio-data.mjs).
  const baseUrl = process.env.VALIO_API_URL?.trim()
    .replace(/\/+$/, "")
    .replace(/\/(docs|redoc|openapi\.json|api)$/i, "");
  const customer = process.env.VALIO_CUSTOMER?.trim() || "123";
  return { apiKey, baseUrl, customer };
}

let warnedMock = false;

export function valioSource(): ValioSource {
  const source: ValioSource = config().apiKey ? "valio" : "mock";
  // A production server without a key silently serves fake prices: say so once in the logs.
  if (source === "mock" && !warnedMock && process.env.NODE_ENV === "production") {
    warnedMock = true;
    console.warn("VALIO_API_KEY is not set: prices and availability are MOCK data (see GET /api/health).");
  }
  return source;
}

/**
 * How long to wait before the single retry of a failed Valio call, or null for no retry.
 * Retried: connection failures (status null, not timeouts), 429 and 502/503/504, honouring
 * Retry-After (seconds, capped at 5 s). Not retried: other 4xx (the request is wrong) and timeouts
 * (they already waited TIMEOUT_MS).
 */
export function transientRetryDelay(status: number | null, retryAfter: string | null, timedOut = false): number | null {
  if (timedOut) return null;
  if (status !== null && ![429, 502, 503, 504].includes(status)) return null;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 5) * 1000 : 800;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function post<T>(path: string, body: ValioProductsRequest, schema: { parse: (v: unknown) => T }): Promise<T> {
  const { apiKey, baseUrl } = config();
  if (!baseUrl) throw new ValioApiError("VALIO_API_URL is not set", null);

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey! },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      const delay = attempt === 1 ? transientRetryDelay(null, null, timedOut) : null;
      if (delay !== null) {
        await sleep(delay);
        continue;
      }
      throw new ValioApiError(`Valio ${path} unreachable: ${err instanceof Error ? err.message : err}`, null);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const delay = attempt === 1 ? transientRetryDelay(res.status, res.headers.get("retry-after")) : null;
      if (delay !== null) {
        await sleep(delay);
        continue;
      }
      throw new ValioApiError(`Valio ${path} failed with HTTP ${res.status}: ${text}`, res.status);
    }
    try {
      return schema.parse(await res.json());
    } catch (err) {
      throw new ValioApiError(`Valio ${path} returned an unexpected shape: ${err instanceof Error ? err.message : err}`, res.status);
    }
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------- Mock data (deterministic per product id) ----------

function seed(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

function mockPrice(productId: string, date: string): ValioProductPrice {
  const net = Math.round((1 + seed(productId) * 49) * 100) / 100;
  const taxRate = 14;
  const gross = Math.round(net * (1 + taxRate / 100) * 100) / 100;
  const price = { value: net, valueWithTax: gross, validFrom: date, validTo: date, currency: "EUR" };
  return {
    productId,
    quantity: 1,
    catalogPrice: price,
    priceWithTax: { value: gross, validFrom: date, validTo: date, currency: "EUR" },
    comparisonPrice: null,
    comparisonUnit: null,
    tax: { taxRate, taxValue: Math.round((gross - net) * 100) / 100 },
    listPrice: price,
    netPriceFound: false,
    error: false,
  };
}

function mockAvailability(productId: string, date: string): ValioProductAvailability {
  const s = seed(productId);
  const terminal = s > 0.8;
  const unavailable = s < 0.1;
  return {
    productId,
    closingTime: `${date}T10:00:00`,
    salesBlock: false,
    logisticModel: terminal ? "Terminal" : "Stock",
    scheduleLines: unavailable
      ? []
      : [
          {
            salesBlock: false,
            availableAmount: terminal ? VALIO_UNKNOWN_AMOUNT : Math.floor(s * 500),
            availableDate: date,
            salesUnit: "ST",
          },
        ],
  };
}

// ---------- Public functions ----------

/** Prices for the given products on `date` (YYYY-MM-DD). Splits into ≤ 1 000-product requests. */
export async function fetchPrices(productIds: string[], date: string): Promise<ValioProductPrice[]> {
  if (productIds.length === 0) return [];
  if (valioSource() === "mock") return productIds.map((id) => mockPrice(id, date));
  const { customer } = config();
  const results = await Promise.all(
    chunks(productIds, MAX_PRODUCTS_PER_REQUEST).map((products) =>
      post("/api/price", { customer, requestedDate: date, products }, ValioPriceResponse),
    ),
  );
  return results.flatMap((r) => r.products);
}

/** Availability for the given products on `date` (YYYY-MM-DD). */
export async function fetchAvailability(productIds: string[], date: string): Promise<ValioProductAvailability[]> {
  if (productIds.length === 0) return [];
  if (valioSource() === "mock") return productIds.map((id) => mockAvailability(id, date));
  const { customer } = config();
  const results = await Promise.all(
    chunks(productIds, MAX_PRODUCTS_PER_REQUEST).map((products) =>
      post("/api/availability", { customer, requestedDate: date, products }, ValioAvailabilityResponse),
    ),
  );
  return results.flatMap((r) => r.products);
}
