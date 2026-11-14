import type { Offer, OffersResponse, ProductDetail } from "@/shared/contracts/products";

import { realScenarioProducts, type RealCatalog } from "./mocks/scenarios";
import type { ProvisionalOffer, ProvisionalProduct } from "./provisional/types";

// Real products, prices and availability for the simulated scenarios in connected mode: product
// details and offers from our backend (GET /api/products/{id}, POST /api/offers), converted to the
// provisional shapes the screens use. Everything else in the flow is still simulated.

const DELIVERY_DATE = "2026-11-20"; // the date in the scenario prompts

// Litres in one sales unit (case). Curated: the catalog has no content volume for these.
const LITRES_PER_SALES_UNIT: Record<string, number> = {
  "469330": 5, // 5 x 1 L
  "469386": 5, // 5 x 1 L
  "469040": 10, // 10 x 1 L
  "470611": 5, // 10 x 0.5 L
};

type CatalogApi = {
  getProduct: (id: string) => Promise<ProductDetail>;
  getOffers: (productIds: string[], date: string) => Promise<OffersResponse>;
};

const minor = (euros: number) => String(Math.round(euros * 100));

export function toProduct(p: ProductDetail): ProvisionalProduct {
  return {
    productId: p.id,
    name: p.name,
    language: "en",
    brand: p.brand ?? undefined,
    salesUnit: p.salesUnit,
    baseUnit: p.baseUnit,
    allowedLotSize: String(p.allowedLotSize),
    countryOfOrigin: p.countryOfOrigin?.toUpperCase() ?? undefined,
  };
}

export function toOffer(offer: Offer, source: OffersResponse["source"]): ProvisionalOffer {
  const { price, availability } = offer;
  const hasPrice = !!price?.found && price.priceInclVat !== null;
  const quantity = availability?.availableQuantity ?? null;
  const stockCertainty: ProvisionalOffer["stockCertainty"] = !availability
    ? "SUPPLIER_UNKNOWN"
    : availability.salesBlock
      ? "BLOCKED"
      : !availability.orderable
        ? quantity === 0
          ? "OUT_OF_STOCK"
          : "NOT_DELIVERABLE"
        : quantity === null
          ? "SUPPLIER_UNKNOWN" // terminal products: the supplier doesn't report quantities
          : "STOCK_VERIFIED";
  const errorCodes = [
    ...(hasPrice ? [] : ["NO_PRICE"]),
    ...(availability?.salesBlock ? ["SALES_BLOCK"] : []),
  ];
  return {
    productId: offer.productId,
    requestedDate: offer.date,
    priceGross: hasPrice ? { currency: "EUR", amountMinor: minor(price!.priceInclVat!) } : null,
    availableSalesUnits: quantity === null ? null : String(quantity),
    availableDate: availability?.availableDate?.slice(0, 10) ?? null,
    salesUnit: price?.salesUnit ?? availability?.salesUnit ?? "ST",
    stockCertainty,
    blocked: !hasPrice || !!availability?.salesBlock,
    errorCodes,
    checkedAt: availability?.fetchedAt ?? price?.fetchedAt ?? new Date().toISOString(),
    source: source === "valio" ? "VALIO_API" : "VALIO_MOCK",
  };
}

/** Loads the curated products and their offers once; a failure is not cached, so the next run retries. */
export function createCatalogLoader(api: CatalogApi): () => Promise<RealCatalog> {
  let pending: Promise<RealCatalog> | null = null;
  return () => {
    pending ??= load(api).catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}

async function load(api: CatalogApi): Promise<RealCatalog> {
  const ids = [...new Set(Object.values(realScenarioProducts).flat())];
  const [details, offers] = await Promise.all([
    Promise.all(ids.map((id) => api.getProduct(id))),
    api.getOffers(ids, DELIVERY_DATE),
  ]);
  const byId: Record<string, ProvisionalOffer> = {};
  for (const offer of offers.offers) byId[offer.productId] = toOffer(offer, offers.source);
  if (ids.some((id) => !byId[id])) throw new Error("The catalog did not return every product.");
  return { products: details.map(toProduct), offers: byId, litresPerSalesUnit: LITRES_PER_SALES_UNIT };
}
