import "server-only";

import { RequestContext } from "@mastra/core/request-context";

import { purchasingAgent } from "@/server/agents/purchasing-agent";
import { getMastra } from "@/server/mastra";
import { createPriceAvailabilityInquiry, searchCatalogProducts } from "@/server/services/inquiry";
import {
  checkRecurringOrderAnomalies,
  evaluateProductSubstitutions,
  getProactiveRecommendations,
  getProactiveStockoutAlerts,
  verifyOrderTrustClaims,
} from "@/server/services/intelligence";
import { listInventory } from "@/server/services/inventory";
import {
  checkoutOrder,
  createOrderFromPrompt,
  getOrderDetail,
  listOrders,
  modifyOrder,
} from "@/server/services/orders";
import { getEffectiveFor } from "@/server/services/preferences";
import {
  createOrderFromRecipe,
  findRecipeByDishQuery,
  listRecipes,
} from "@/server/services/recipes";
import type {
  AgentRunRequest,
  AgentRunResponse,
  AgentToolCallTrace,
} from "@/shared/contracts/agent";
import type { SessionUser } from "@/shared/contracts/me";
import type { CreatedOrder } from "@/shared/contracts/orders";

function extractOrderIdFromMessage(message: string): string | null {
  const m = /\b(ORD-[A-Z0-9-]+)\b/i.exec(message);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Executes an autonomous turn of the Valio Aimo Purchasing Agent.
 * - With `GOOGLE_GENERATIVE_AI_API_KEY`: runs Mastra `purchasingAgent` with multi-step tool calling.
 * - Without `GOOGLE_GENERATIVE_AI_API_KEY`: runs a deterministic orchestration router over the exact
 *   same catalog, inquiry, order, modification, and checkout services so CI/offline demos work seamlessly.
 */
export async function runPurchasingAgent(
  input: AgentRunRequest,
  actor?: SessionUser | null,
): Promise<AgentRunResponse> {
  const referencedOrderId = input.orderId ?? extractOrderIdFromMessage(input.message);

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const agent = process.env.DATABASE_URL
      ? getMastra().getAgentById("purchasing-agent")
      : purchasingAgent;

    let preferredLanguage: "en" | "fi" | "sv" = "en";
    if (actor && process.env.DATABASE_URL) {
      try {
        const effective = await getEffectiveFor(
          actor.organization.id,
          actor.roles.includes("buyer") ? "buyer" : "approver",
        );
        preferredLanguage = effective.values.language;
      } catch {
        // Fall back to default language when preferences cannot be loaded.
      }
    }

    const contextualMessage = [
      referencedOrderId ? `Active orderId context: ${referencedOrderId}` : null,
      input.deliveryDate ? `Target deliveryDate: ${input.deliveryDate}` : null,
      preferredLanguage === "fi" || preferredLanguage === "sv"
        ? `Preferred response language: ${preferredLanguage}`
        : null,
      `Buyer message: ${input.message}`,
    ]
      .filter(Boolean)
      .join("\n");

    const beforeOrders = await listOrders(actor);
    const beforeLatestId = beforeOrders.orders[0]?.orderId ?? null;

    const requestContext = new RequestContext();
    requestContext.set("actor", actor ?? null);

    const result = await agent.generate(contextualMessage, {
      maxSteps: 6,
      requestContext,
    });

    const toolCalls: AgentToolCallTrace[] = [];
    for (const call of result.toolCalls ?? []) {
      const payload = "payload" in call && call.payload ? call.payload : call;
      const toolName =
        "toolName" in payload && typeof payload.toolName === "string"
          ? payload.toolName
          : "unknown";
      const args =
        "args" in payload && payload.args && typeof payload.args === "object"
          ? (payload.args as Record<string, unknown>)
          : {};
      toolCalls.push({
        toolName,
        args,
        summary: `Invoked ${toolName}.`,
      });
    }

    let activeOrder: CreatedOrder | null = null;
    if (referencedOrderId) {
      try {
        const detail = await getOrderDetail(referencedOrderId, actor);
        activeOrder = detail.order;
      } catch {
        // Ignore if referencedOrderId was not created yet
      }
    }
    if (!activeOrder) {
      const afterOrders = await listOrders(actor);
      const newest = afterOrders.orders[0] ?? null;
      if (newest && newest.orderId !== beforeLatestId) {
        activeOrder = newest;
      }
    }

    return {
      reply: result.text || "Completed procurement action.",
      mode: "gemini",
      toolCalls,
      activeOrder,
    };
  }

  // ---------- Deterministic Autonomous Orchestration (No Gemini Key) ----------
  const toolCalls: AgentToolCallTrace[] = [];
  const msgLower = input.message.toLowerCase();

  // 1. Checkout intent on an active order
  if (
    referencedOrderId &&
    /\b(checkout|check\s+out|place\s+order|finalize|submit\s+order|issue\s+receipt)\b/i.test(
      input.message,
    )
  ) {
    const res = await checkoutOrder(referencedOrderId, {}, actor);
    toolCalls.push({
      toolName: "checkoutOrder",
      args: { orderId: referencedOrderId },
      summary: `Checked out ${referencedOrderId}; issued receipt ${res.receipt.receiptId}.`,
    });
    return {
      reply:
        `Order ${res.order.orderId} has been checked out! ` +
        `Supplier confirmation: ${res.receipt.supplierConfirmationId}, Receipt: ${res.receipt.receiptId}. ` +
        `Total: ${res.receipt.subtotalExclVatEur.toFixed(2)} EUR excl. VAT (${res.receipt.totalInclVatEur.toFixed(2)} EUR incl. VAT) for delivery on ${res.receipt.deliveryDate}.`,
      mode: "deterministic",
      toolCalls,
      activeOrder: res.order,
    };
  }

  // 2. Modify / swap intent on an active order
  if (
    referencedOrderId &&
    /\b(change|swap|replace|switch|update\s+quantity|set\s+quantity|reduce|increase|remove|delete)\b/i.test(
      input.message,
    )
  ) {
    const res = await modifyOrder(
      referencedOrderId,
      { prompt: input.message, deliveryDate: input.deliveryDate },
      actor,
    );
    toolCalls.push({
      toolName: "modifyOrder",
      args: { orderId: referencedOrderId, prompt: input.message },
      summary: res.appliedChangesSummary.join(" "),
    });
    return {
      reply: `${res.appliedChangesSummary.join(" ")} ${res.order.customerReviewPrompt}`,
      mode: "deterministic",
      toolCalls,
      activeOrder: res.order,
    };
  }

  // 3. Cryptographic trust verification intent on an active order
  if (referencedOrderId && /\b(verify|verification|proof|sha-?256|trust)\b/i.test(input.message)) {
    const verification = await verifyOrderTrustClaims(referencedOrderId, actor);
    const detail = await getOrderDetail(referencedOrderId, actor);
    toolCalls.push({
      toolName: "verifyOrderTrust",
      args: { orderId: referencedOrderId },
      summary: `Verified ${verification.claims.length} claim(s) on ${referencedOrderId} (allVerified=${verification.allClaimsVerified}).`,
    });
    return {
      reply: `Verification (${verification.verificationMethod}) for ${referencedOrderId}: allClaimsVerified=${verification.allClaimsVerified}, orderDigest=${verification.orderDigestSha256}, auditChainDigest=${verification.auditChainDigestSha256}.`,
      mode: "deterministic",
      toolCalls,
      activeOrder: detail.order,
    };
  }

  // 3a. Recurring-order anomaly check on an active order
  if (referencedOrderId && /\b(anomal\w*|recurring|spike|baseline)\b/i.test(input.message)) {
    const anomalyRes = await checkRecurringOrderAnomalies(
      { orderId: referencedOrderId, deliveryDate: input.deliveryDate },
      actor,
    );
    toolCalls.push({
      toolName: "checkRecurringAnomalies",
      args: { orderId: referencedOrderId, deliveryDate: input.deliveryDate },
      summary: `Checked ${referencedOrderId} against ${anomalyRes.historicalOrderCount} historical order(s) (safeToAutoRepeat=${anomalyRes.safeToAutoRepeat}, anomalies=${anomalyRes.anomalies.length}).`,
    });
    const anomalyLines =
      anomalyRes.anomalies.length > 0
        ? anomalyRes.anomalies
            .map((a) => `- [${a.severity.toUpperCase()}] ${a.anomalyType}: ${a.explanation}`)
            .join("\n")
        : "No anomalies detected against historical baselines.";
    return {
      reply:
        `Recurring-order anomaly check for ${referencedOrderId}: ` +
        `safeToAutoRepeat=${anomalyRes.safeToAutoRepeat}, ` +
        `proposedTotalEur=${anomalyRes.proposedTotalEur.toFixed(2)} EUR, ` +
        `anomalies=${anomalyRes.anomalies.length}.\n${anomalyLines}`,
      mode: "deterministic",
      toolCalls,
      activeOrder: null,
    };
  }

  // 3b. Inspect / status / audit intent on an active order
  if (
    referencedOrderId &&
    /\b(status|audit|details|inspect|show\s+order|receipt)\b/i.test(input.message)
  ) {
    const detail = await getOrderDetail(referencedOrderId, actor);
    toolCalls.push({
      toolName: "getOrderDetails",
      args: { orderId: referencedOrderId },
      summary: `Loaded order ${detail.order.orderId} (status: ${detail.order.status}).`,
    });
    return {
      reply: detail.order.customerReviewPrompt,
      mode: "deterministic",
      toolCalls,
      activeOrder: detail.order,
    };
  }

  // 3c. Proactive stock-out alerts
  if (/\b(stock-?out|shortage|shortages|par\s+level|stock\s+alert)\b/i.test(msgLower)) {
    const alertsRes = await getProactiveStockoutAlerts(input.deliveryDate, actor);
    toolCalls.push({
      toolName: "getStockoutAlerts",
      args: { deliveryDate: input.deliveryDate },
      summary: `Found ${alertsRes.alerts.length} supplier/kitchen stock shortage alert(s).`,
    });
    const alertText = alertsRes.alerts
      .map(
        (a) =>
          `- [${a.severity}] ${a.shortageSummary} Top replacement: ${a.recommendedReplacements[0]?.candidate.name ?? "none"}`,
      )
      .join("\n");
    return {
      reply: `Detected ${alertsRes.alerts.length} shortage alert(s):\n${alertText}`,
      mode: "deterministic",
      toolCalls,
      activeOrder: null,
    };
  }

  // 3d. Proactive supplier recommendations
  if (/\b(recommend|recommendations|seasonal|new\s+arrival)\b/i.test(msgLower)) {
    const recRes = await getProactiveRecommendations(actor);
    toolCalls.push({
      toolName: "getProactiveRecommendations",
      args: {},
      summary: `Generated ${recRes.recommendations.length} tailored recommendation(s).`,
    });
    const recText = recRes.recommendations
      .map(
        (r) =>
          `- ${r.headline} (${r.product.id}, ${r.unitPriceEur.toFixed(2)} EUR/${r.product.salesUnit}): ${r.rationale}`,
      )
      .join("\n");
    return {
      reply: `Proactive Valio Aimo recommendations:\n${recText}`,
      mode: "deterministic",
      toolCalls,
      activeOrder: null,
    };
  }

  // 3e. Allergen-safe product substitutions lookup
  const subSkuMatch = /\b(substitut\w*|alternativ\w*)\b.*?\b(\d{5,8})\b/i.exec(input.message);
  if (subSkuMatch) {
    const targetSku = subSkuMatch[2]!;
    const subRes = await evaluateProductSubstitutions(
      { productId: targetSku, requestedQuantity: 100, deliveryDate: input.deliveryDate },
      actor,
    );
    toolCalls.push({
      toolName: "evaluateSubstitutions",
      args: { productId: targetSku },
      summary: `Ranked ${subRes.rankedSubstitutes.length} allergen-safe substitute(s) for ${targetSku}.`,
    });
    const subLines = subRes.rankedSubstitutes
      .map(
        (s) =>
          `- [${s.tier.toUpperCase()}] ${s.candidate.name} (${s.candidate.id}): ${s.candidate.unitPriceEur.toFixed(2)} EUR/${s.candidate.salesUnit} (${s.tradeOffs.join("; ")})`,
      )
      .join("\n");
    return {
      reply: `Allergen-safe substitutes for ${subRes.targetProduct.name} (${targetSku}):\n${subLines}`,
      mode: "deterministic",
      toolCalls,
      activeOrder: null,
    };
  }

  // 3f. Inspect kitchen inventory or list recipes (without ordering)
  if (
    !/\b(buy|order|make|cook|prepare)\b/i.test(msgLower) &&
    /\b(inventory|kitchen\s+stock)\b/i.test(msgLower)
  ) {
    const inv = await listInventory(actor);
    toolCalls.push({
      toolName: "getKitchenInventory",
      args: {},
      summary: `Loaded ${inv.items.length} kitchen inventory item(s).`,
    });
    return {
      reply: `Current kitchen inventory (${inv.items.length} items):\n${inv.items.map((i) => `- ${i.ingredientName}: ${i.quantityInStock} ${i.unit} (par: ${i.minParLevel ?? "N/A"})`).join("\n")}`,
      mode: "deterministic",
      toolCalls,
      activeOrder: null,
    };
  }

  if (
    !/\b(buy|order|make|cook|prepare)\b/i.test(msgLower) &&
    /\b(recipes|recipe\s+book|what\s+dishes)\b/i.test(msgLower)
  ) {
    const recipes = await listRecipes({}, actor);
    toolCalls.push({
      toolName: "listRecipes",
      args: {},
      summary: `Found ${recipes.recipes.length} recipe(s).`,
    });
    return {
      reply: `Available recipes (${recipes.recipes.length}):\n${recipes.recipes.map((r) => `- ${r.name} (${r.id}, base ${r.baseServings} servings)`).join("\n")}`,
      mode: "deterministic",
      toolCalls,
      activeOrder: null,
    };
  }

  // 3g. Recipe-to-order workflow intent (e.g. "Order products for salmon soup for 40 servings")
  if (
    /\b(recipe|salmon\s+soup|lohikeitto|potato\s+gratin|canteen\s+bake|cloudberry\s+quark\s+bowl|make|cook|prepare)\b/i.test(
      msgLower,
    )
  ) {
    const matchedRecipe = await findRecipeByDishQuery(input.message, actor);
    if (matchedRecipe) {
      const servingsMatch = /(\d+(?:[.,]\d+)?)\s*(?:servings?|portions?|people|persons?)\b/i.exec(
        input.message,
      );
      const servings = servingsMatch
        ? Number.parseFloat(servingsMatch[1]!.replace(",", "."))
        : undefined;

      const recipeOrder = await createOrderFromRecipe(
        {
          recipeId: matchedRecipe.id,
          servings,
          deliveryDate: input.deliveryDate,
        },
        actor,
      );
      toolCalls.push({
        toolName: "createOrderFromRecipe",
        args: {
          recipeId: matchedRecipe.id,
          servings: recipeOrder.requestedServings,
          deliveryDate: input.deliveryDate,
        },
        summary: `Created recipe order ${recipeOrder.order.orderId} for '${matchedRecipe.name}' (${recipeOrder.requestedServings} servings; ${recipeOrder.extractedItems.length} net item(s) ordered after subtracting inventory).`,
      });
      return {
        reply: `Prepared recipe order ${recipeOrder.order.orderId} for '${recipeOrder.recipeUsed.name}' (${recipeOrder.requestedServings} servings): ordered ${recipeOrder.order.lines.length} net ingredient(s) after subtracting kitchen inventory (${recipeOrder.order.totalPriceEur.toFixed(2)} EUR excl. VAT). ${recipeOrder.order.customerReviewPrompt}`,
        mode: "deterministic",
        toolCalls,
        activeOrder: recipeOrder.order,
      };
    }
  }

  // 4. Pure catalog search / price-and-availability inquiry intent (without buying)
  if (
    !/\b(buy|order|want|need|purchase|procure)\b/i.test(msgLower) &&
    /\b(search|find|list|what\s+products|inquire|availability|price\s+of)\b/i.test(msgLower)
  ) {
    const cleanedQuery = input.message
      .replace(
        /\b(search|find|list|for|products|what|do|you|have|check|inquire|availability|price|of)\b/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

    const searchRes = await searchCatalogProducts({
      q: cleanedQuery || undefined,
      limit: 5,
      offset: 0,
    });
    toolCalls.push({
      toolName: "searchProducts",
      args: { query: cleanedQuery },
      summary: `Found ${searchRes.total} matching product(s).`,
    });

    if (searchRes.items.length > 0) {
      const inquiry = await createPriceAvailabilityInquiry({
        items: searchRes.items.slice(0, 3).map((p) => ({ productId: p.id, quantity: 10 })),
        deliveryDate: input.deliveryDate,
      });
      toolCalls.push({
        toolName: "inquirePriceAvailability",
        args: { productIds: searchRes.items.slice(0, 3).map((p) => p.id) },
        summary: `Quoted fixed prices via inquiry ${inquiry.inquiryId}.`,
      });
      const linesSummary = inquiry.lines
        .map(
          (l) =>
            `- ${l.productName} (${l.productId}): ${l.fixedUnitPriceExclVat?.toFixed(2) ?? "N/A"} EUR/${l.salesUnit}, stock: ${l.availableQuantity ?? "terminal"} (${l.stockStatus})`,
        )
        .join("\n");
      return {
        reply: `Found ${searchRes.total} matching product(s). Top quotes (Inquiry ${inquiry.inquiryId}):\n${linesSummary}`,
        mode: "deterministic",
        toolCalls,
        activeOrder: null,
      };
    }
  }

  // 5. Default autonomous procurement flow: extract -> search -> filter -> rank -> inquire -> guardrails -> create order
  const created = await createOrderFromPrompt(
    {
      prompt: input.message,
      deliveryDate: input.deliveryDate,
    },
    actor,
  );
  toolCalls.push({
    toolName: "createProcurementOrder",
    args: { prompt: input.message, deliveryDate: input.deliveryDate },
    summary: `Created order ${created.order.orderId} (${created.order.status}, ${created.order.totalPriceEur.toFixed(2)} EUR).`,
  });

  const lineSummary = created.order.lines
    .map(
      (l) =>
        `${l.quantity} ${l.unit} of '${l.productName}' (${l.productId}) @ ${l.unitPriceEur.toFixed(2)} EUR/${l.unit} = ${l.lineTotalEur.toFixed(2)} EUR [${l.stockStatus}]`,
    )
    .join("; ");

  return {
    reply:
      created.order.lines.length > 0
        ? `Prepared order ${created.order.orderId} (${created.order.status}): ${lineSummary}. ${created.order.customerReviewPrompt}`
        : created.order.customerReviewPrompt,
    mode: "deterministic",
    toolCalls,
    activeOrder: created.order,
  };
}
