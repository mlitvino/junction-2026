import "server-only";

import { inArray } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { valioProduct } from "@/server/db/schema";
import { evaluatePolicy, lineTotal, type PolicyLineFacts } from "@/server/policy/evaluate";
import type { PolicyDecision, PolicyEvaluateRequest } from "@/shared/contracts/policy";

import { getAvailability, getPrices, today } from "./catalog";
import { getEffectiveFor } from "./preferences";

/**
 * Policy check for a draft order in an organization. Uses the buyer's effective preferences
 * (the agent buys for the buyer, so they decide even when an approver asks), the catalog facts
 * and server-side prices and availability for the requested delivery date (`date`).
 * Stateless: nothing is stored. Rules: server/policy/evaluate.ts.
 */
export async function evaluateDraft(
  organizationId: string,
  request: PolicyEvaluateRequest,
): Promise<PolicyDecision> {
  const date = request.date ?? today();
  const ids = [...new Set(request.lines.map((l) => l.productId))];

  await ensureDatabase();
  const [effective, products, prices, availability] = await Promise.all([
    getEffectiveFor(organizationId, "buyer"),
    getDb()
      .select({
        id: valioProduct.id,
        vendorName: valioProduct.vendorName,
        category: valioProduct.category,
        allergens: valioProduct.allergens,
        co2PerKg: valioProduct.co2PerKg,
        deliveryReliability: valioProduct.deliveryReliability,
      })
      .from(valioProduct)
      .where(inArray(valioProduct.id, ids)),
    getPrices({ productIds: ids, date }),
    getAvailability({ productIds: ids, date }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const quoteById = new Map(prices.quotes.map((q) => [q.productId, q]));
  const availabilityById = new Map(availability.items.map((a) => [a.productId, a]));

  const facts: PolicyLineFacts[] = request.lines.map((line) => {
    const quote = quoteById.get(line.productId);
    return {
      productId: line.productId,
      quantity: line.quantity,
      product: productById.get(line.productId) ?? null,
      unitPriceExclVat: quote?.found ? quote.priceExclVat : null,
      salesUnit: quote?.salesUnit ?? null,
      availability: availabilityById.get(line.productId) ?? null,
    };
  });

  const prefs = effective.values;
  const result = evaluatePolicy(prefs, facts, { requestedDate: date });
  return {
    ...result,
    lines: facts.map((f) => ({
      productId: f.productId,
      quantity: f.quantity,
      salesUnit: f.salesUnit ?? null,
      unitPriceExclVat: f.unitPriceExclVat,
      lineTotalExclVat: lineTotal(f),
      orderable: f.availability?.orderable ?? null,
      availableDate: f.availability?.availableDate ?? null,
      availableQuantity: f.availability?.availableQuantity ?? null,
    })),
    currency: prices.currency,
    pricingDate: date,
    source: prices.source,
    limits: {
      maxOrderValue: prefs.maxOrderValue,
      autoApproveBelow: prefs.autoApproveBelow,
      autonomy: prefs.autonomy,
    },
    evaluatedAt: new Date().toISOString(),
  };
}
