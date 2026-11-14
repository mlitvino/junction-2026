import "server-only";

import { inArray } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { valioProduct } from "@/server/db/schema";
import { evaluatePolicy, lineTotal, type PolicyLineFacts } from "@/server/policy/evaluate";
import type { PolicyDecision, PolicyEvaluateRequest } from "@/shared/contracts/policy";

import { getPrices, today } from "./catalog";
import { getEffectiveFor } from "./preferences";

/**
 * Policy check for a draft order in an organization. Uses the buyer's effective preferences
 * (the agent buys for the buyer, so they decide even when an approver asks), the catalog facts
 * and server-side prices. Stateless: nothing is stored. Rules: server/policy/evaluate.ts.
 */
export async function evaluateDraft(
  organizationId: string,
  request: PolicyEvaluateRequest,
): Promise<PolicyDecision> {
  const date = request.date ?? today();
  const ids = [...new Set(request.lines.map((l) => l.productId))];

  await ensureDatabase();
  const [effective, products, prices] = await Promise.all([
    getEffectiveFor(organizationId, "buyer"),
    getDb()
      .select({
        id: valioProduct.id,
        vendorName: valioProduct.vendorName,
        allergens: valioProduct.allergens,
        co2PerKg: valioProduct.co2PerKg,
        deliveryReliability: valioProduct.deliveryReliability,
      })
      .from(valioProduct)
      .where(inArray(valioProduct.id, ids)),
    getPrices({ productIds: ids, date }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const quoteById = new Map(prices.quotes.map((q) => [q.productId, q]));

  const facts: PolicyLineFacts[] = request.lines.map((line) => {
    const quote = quoteById.get(line.productId);
    return {
      productId: line.productId,
      quantity: line.quantity,
      product: productById.get(line.productId) ?? null,
      unitPriceExclVat: quote?.found ? quote.priceExclVat : null,
    };
  });

  const prefs = effective.values;
  const result = evaluatePolicy(prefs, facts);
  return {
    ...result,
    lines: facts.map((f) => ({
      productId: f.productId,
      quantity: f.quantity,
      salesUnit: quoteById.get(f.productId)?.salesUnit ?? null,
      unitPriceExclVat: f.unitPriceExclVat,
      lineTotalExclVat: lineTotal(f),
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
