import "server-only";

import { getHealth } from "@/server/services/health";
import { HealthResponseSchema } from "@/shared/contracts/health";

import { createRouter } from "../../router";
import { getHealthRoute } from "./health.docs";

export const healthRouter = createRouter().openapi(getHealthRoute, (c) =>
  // Runtime check that the service still matches the contract.
  c.json(HealthResponseSchema.parse(getHealth()), 200),
);
