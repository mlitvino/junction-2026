import type { z } from "zod";

import { HealthResponseSchema, type HealthResponse } from "@/shared/contracts/health";
import { MeResponseSchema, type MeResponse } from "@/shared/contracts/me";
import {
  OffersResponseSchema,
  ProductDetailSchema,
  type OffersResponse,
  type ProductDetail,
} from "@/shared/contracts/products";

import { healthMock } from "./mocks/health";
import { meMock } from "./mocks/me";
import { createMockProcurementService } from "./mocks/mock-service";
import type { ProvisionalProcurementService } from "./provisional/types";
import { createCatalogLoader } from "./real-catalog";

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";
const MOCK_DELAY_MS = 300;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  mock: () => z.input<S>,
  init?: RequestInit,
): Promise<z.output<S>> {
  if (USE_MOCKS) {
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
    return schema.parse(mock());
  }

  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new ApiError(`${init?.method ?? "GET"} ${path} failed: ${res.status}`, res.status);
  }
  return schema.parse(await res.json());
}

// Real catalog calls. Mock mode never makes them (the simulator uses its synthetic products).
const noMockCatalog = (): never => {
  throw new Error("The catalog needs the backend; it is not available with NEXT_PUBLIC_USE_MOCKS=true.");
};
const getProduct = (id: string): Promise<ProductDetail> =>
  request(`/api/products/${encodeURIComponent(id)}`, ProductDetailSchema, noMockCatalog);
const getOffers = (productIds: string[], date?: string): Promise<OffersResponse> =>
  request("/api/offers", OffersResponseSchema, noMockCatalog, {
    method: "POST",
    body: JSON.stringify({ productIds, date }),
  });

export const apiClient = {
  // The procurement flow has no backend yet: both modes run the local simulator. In connected
  // mode ("simulated") it acts for the signed-in user (see use-viewer.ts) with their real roles.
  procurement: createMockProcurementService({
    storage: () => (typeof window === "undefined" ? null : window.sessionStorage),
    mode: USE_MOCKS ? "mock" : "simulated",
    // Connected mode: the scenarios use real products, prices and availability from the backend.
    catalog: USE_MOCKS ? undefined : createCatalogLoader({ getProduct, getOffers }),
  }) as ProvisionalProcurementService,
  getHealth: (): Promise<HealthResponse> =>
    request("/api/health", HealthResponseSchema, healthMock),
  getProduct,
  getOffers,
  getMe: (): Promise<MeResponse> => request("/api/me", MeResponseSchema, meMock),
};
