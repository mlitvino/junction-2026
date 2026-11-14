import type { z } from "zod";

import { HealthResponseSchema, type HealthResponse } from "@/shared/contracts/health";
import { MeResponseSchema, type MeResponse } from "@/shared/contracts/me";

import { healthMock } from "./mocks/health";
import { meMock } from "./mocks/me";
import { createMockProcurementService } from "./mocks/mock-service";
import { createUnavailableProcurementService } from "./provisional/unavailable-service";
import type { ProvisionalProcurementService } from "./provisional/types";

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

export const apiClient = {
  procurement: (USE_MOCKS
    ? createMockProcurementService({
        storage: () => (typeof window === "undefined" ? null : window.sessionStorage),
      })
    : createUnavailableProcurementService()) as ProvisionalProcurementService,
  getHealth: (): Promise<HealthResponse> =>
    request("/api/health", HealthResponseSchema, healthMock),
  getMe: (): Promise<MeResponse> => request("/api/me", MeResponseSchema, meMock),
};
