import {
  ProductSchema,
  ScenarioSchema,
  type ProvisionalEvidence,
  type ProvisionalScenario,
} from "../provisional/types";

// Every price, stock assertion, product and decision here is artificial demo data.
export const demoScenarios = [
  {
    id: "happy-path-auto",
    label: "Within the demo limit",
    description: "Lactose-free milk · autonomous local purchase",
    prompt:
      "Order 100 litres of lactose-free milk for 20 November 2026. Budget €200. Prefer Finnish products.",
  },
  {
    id: "human-approval-budget",
    label: "Manager approval needed",
    description: "A larger milk purchase · review by an approver",
    prompt:
      "Order 400 litres of lactose-free milk for 20 November 2026. Budget €800. Prefer Finnish products.",
  },
  {
    id: "allergen-blocked",
    label: "A requirement cannot be verified",
    description: "Milk-protein-free oat drink · purchase blocked",
    prompt:
      "Order 100 litres of milk-protein-free oat drink for 20 November 2026. Budget €200. No milk allergens.",
  },
].map((value) => ScenarioSchema.parse(value));

export const demoProducts = [
  {
    productId: "demo-milk-1",
    name: "Nordic lactose-free milk, 1 litre",
    brand: "Demo Kitchen",
    countryOfOrigin: "FI",
  },
  {
    productId: "demo-milk-2",
    name: "Lactose-free kitchen milk, 1 litre",
    brand: "Demo Dairy",
    countryOfOrigin: "SE",
  },
  {
    productId: "demo-oat-1",
    name: "Oat drink, 1 litre",
    brand: "Demo Oats",
    countryOfOrigin: "FI",
  },
  {
    productId: "demo-oat-2",
    name: "Barista oat drink, 1 litre",
    brand: "Demo Pantry",
    countryOfOrigin: "SE",
  },
].map((value) =>
  ProductSchema.parse({
    ...value,
    language: "en",
    salesUnit: "ST",
    baseUnit: "ST",
    allowedLotSize: "1",
  }),
);

export function scenarioFixture(id: ProvisionalScenario["id"], timestamp: string) {
  const scenario = demoScenarios.find((item) => item.id === id)!;
  const blocked = id === "allergen-blocked";
  const approval = id === "human-approval-budget";
  const quantity = approval ? "400" : "100";
  const total = blocked ? "18000" : approval ? "62000" : "15500";
  const productId = blocked ? "demo-oat-1" : "demo-milk-1";
  function evidence(candidateId: string, alternative: boolean): ProvisionalEvidence {
    return {
      productId: candidateId,
      match: blocked ? "UNKNOWN" : "PASS",
      physicalMeasureStatus: "CURATED",
      constraintResults: [
        {
          code: blocked ? "MILK_ALLERGEN" : "LACTOSE_FREE",
          result: blocked ? "UNKNOWN" : "PASS",
          reason: blocked
            ? "The fixture has no milk-allergen or cross-contact evidence. Safety cannot be confirmed."
            : "The synthetic fixture explicitly includes a lactose-free claim.",
          source: "Synthetic frontend fixture, not supplier evidence",
        },
      ],
      selectionReason: blocked
        ? "Shown for review only. The mandatory milk-allergen requirement is unverified."
        : alternative
          ? "An illustrative alternative with a different origin and unit price."
          : "Matches the prepared demo requirements and preferred Finnish origin.",
      offer: {
        productId: candidateId,
        requestedDate: "2026-11-20",
        priceGross: { currency: "EUR", amountMinor: blocked ? "180" : alternative ? "165" : "155" },
        availableSalesUnits: blocked ? null : "1000",
        availableDate: blocked ? null : "2026-11-20",
        salesUnit: "ST",
        stockCertainty: blocked ? "SUPPLIER_UNKNOWN" : "STOCK_VERIFIED",
        blocked,
        errorCodes: blocked ? ["MANDATORY_EVIDENCE_UNKNOWN"] : [],
        source: "SYNTHETIC_FRONTEND_FIXTURE",
        checkedAt: timestamp,
      },
    };
  }
  return {
    scenario,
    quantity,
    total,
    budget: approval ? "80000" : "20000",
    productId,
    query: blocked ? "Milk-protein-free oat drink" : "Lactose-free milk",
    evidence: evidence(productId, false),
    alternatives: [evidence(blocked ? "demo-oat-2" : "demo-milk-2", true)],
    outcome: blocked
      ? ("DENY" as const)
      : approval
        ? ("REQUIRE_APPROVAL" as const)
        : ("ALLOW" as const),
    reason: blocked
      ? {
          code: "MANDATORY_EVIDENCE_UNKNOWN",
          message:
            "The mandatory milk-allergen condition cannot be verified. This demo will not create an order.",
        }
      : approval
        ? {
            code: "SPEND_LIMIT_EXCEEDED",
            message:
              "The prepared €620 purchase exceeds the fictional €250 agent limit. An approver must decide.",
          }
        : {
            code: "WITHIN_DEMO_LIMIT",
            message:
              "The prepared €155 purchase is within the fictional €250 agent limit. This is a scripted demonstration decision.",
          },
  };
}
