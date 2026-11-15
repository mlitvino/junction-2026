import "server-only";

import { RequestContext } from "@mastra/core/request-context";

import { callModel, isAgentTestMode, requireGeminiApiKey } from "@/server/agents/mode";
import { toPlainReply } from "@/server/agents/plain-text";
import { purchasingAgent } from "@/server/agents/purchasing-agent";
import { ACTOR_KEY } from "@/server/agents/tools/actor";
import { getMastra } from "@/server/mastra";
import { listAudit } from "@/server/services/audit";
import { searchProducts } from "@/server/services/catalog";
import { createPriceAvailabilityInquiry } from "@/server/services/inquiry";
import {
  evaluateProductSubstitutions,
  getProactiveRecommendations,
  getProactiveStockoutAlerts,
} from "@/server/services/intelligence";
import { listInventory } from "@/server/services/inventory";
import {
  actorFor,
  getProposal,
  listProposals,
  placeOrder,
  PurchasingError,
  verifyProposal,
} from "@/server/services/purchasing";
import { createProposalFromRecipe, findRecipeByDishQuery, listRecipes } from "@/server/services/recipes";
import { createProposalFromPrompt, nextStepMessage, reviseProposalFromRequest } from "@/server/services/selection";
import type { AgentRunRequest, AgentRunResponse, AgentToolCallTrace } from "@/shared/contracts/agent";
import type { SessionUser } from "@/shared/contracts/me";
import type { Proposal } from "@/shared/contracts/purchasing";

const UUID = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

function proposalIdFromMessage(message: string): string | null {
  return UUID.exec(message)?.[1]?.toLowerCase() ?? null;
}

/**
 * One turn of the purchasing agent, always acting for the signed-in buyer (`actor`). Whatever it
 * does goes through the purchasing flow: it creates and revises proposals and may place an order
 * only when the organization's rules allow it (or an approver approved); it never approves.
 * - `TEST_MODE=TRUE`: deterministic router over the same services.
 * - Otherwise: Mastra `purchasingAgent` with tool calling (requires `GOOGLE_GENERATIVE_AI_API_KEY`).
 */
export async function runPurchasingAgent(input: AgentRunRequest, user: SessionUser): Promise<AgentRunResponse> {
  const actor = actorFor(user, true);
  const referencedId = input.proposalId ?? proposalIdFromMessage(input.message);
  const load = async (id: string | null): Promise<Proposal | null> => {
    if (!id) return null;
    try {
      return await getProposal(actor, id);
    } catch (err) {
      if (err instanceof PurchasingError && err.status === 404) return null;
      throw err;
    }
  };

  if (!isAgentTestMode()) {
    requireGeminiApiKey();
    const agent = process.env.DATABASE_URL ? getMastra().getAgentById("purchasing-agent") : purchasingAgent;
    const contextualMessage = [
      referencedId ? `Active proposalId context: ${referencedId}` : null,
      input.deliveryDate ? `Target deliveryDate: ${input.deliveryDate}` : null,
      `Buyer message: ${input.message}`,
    ]
      .filter(Boolean)
      .join("\n");

    const before = (await listProposals(actor, {}))[0]?.id ?? null;
    // Tools act as the signed-in user (agents/tools/actor.ts), never anonymously.
    const requestContext = new RequestContext([[ACTOR_KEY, user]]);
    // A PurchasingError raised by a tool keeps its meaning (400/403/404/409); anything else is the model.
    const result = await callModel(
      () => agent.generate(contextualMessage, { maxSteps: 6, requestContext }),
      (err) => err instanceof PurchasingError,
    );

    const toolCalls: AgentToolCallTrace[] = [];
    for (const call of result.toolCalls ?? []) {
      const payload = "payload" in call && call.payload ? call.payload : call;
      const toolName = "toolName" in payload && typeof payload.toolName === "string" ? payload.toolName : "unknown";
      const args =
        "args" in payload && payload.args && typeof payload.args === "object" ? (payload.args as Record<string, unknown>) : {};
      toolCalls.push({ toolName, args, summary: `Invoked ${toolName}.` });
    }
    let activeProposal = await load(referencedId);
    if (!activeProposal) {
      const newest = (await listProposals(actor, {}))[0] ?? null;
      if (newest && newest.id !== before) activeProposal = newest;
    }
    return { reply: toPlainReply(result.text) || "Done.", mode: "gemini", toolCalls, activeProposal };
  }

  // ---------- Deterministic orchestration (TEST_MODE=TRUE) ----------
  const toolCalls: AgentToolCallTrace[] = [];
  const msgLower = input.message.toLowerCase();

  // 1. Order an existing proposal (only if the rules allow it or an approver approved).
  if (referencedId && /\b(checkout|check\s+out|place\s+(the\s+)?order|finalize|submit\s+order)\b/i.test(input.message)) {
    try {
      const { order } = await placeOrder(actor, referencedId, `agent-${referencedId}`);
      toolCalls.push({ toolName: "placeOrder", args: { proposalId: referencedId }, summary: `Placed order ${order.id}.` });
      return {
        reply: `Placed simulated order ${order.id} for proposal ${referencedId} (${order.totalExclVat?.toFixed(2) ?? "?"} EUR excl. VAT). Receipt: GET /api/orders/${order.id}/receipt.`,
        mode: "deterministic",
        toolCalls,
        activeProposal: await load(referencedId),
      };
    } catch (err) {
      if (!(err instanceof PurchasingError)) throw err;
      return { reply: `Can't order proposal ${referencedId}: ${err.message}`, mode: "deterministic", toolCalls, activeProposal: await load(referencedId) };
    }
  }

  // 2. Change an existing proposal (creates a revised proposal).
  if (referencedId && /\b(change|swap|replace|switch|update\s+quantity|set\s+quantity|reduce|increase|remove|delete)\b/i.test(input.message)) {
    const res = await reviseProposalFromRequest(actor, referencedId, { prompt: input.message, date: input.deliveryDate });
    toolCalls.push({ toolName: "reviseProposal", args: { proposalId: referencedId, prompt: input.message }, summary: res.appliedChanges.join(" ") });
    return {
      reply: `${res.appliedChanges.join(" ")} ${nextStepMessage(res.proposal)}`,
      mode: "deterministic",
      toolCalls,
      activeProposal: res.proposal,
    };
  }

  // 3. Verify a proposal's frozen prices.
  if (referencedId && /\b(verify|verification|proof|sha-?256|trust)\b/i.test(input.message)) {
    const v = await verifyProposal(actor, referencedId);
    const matched = v.lines.filter((l) => l.snapshotFound).length;
    toolCalls.push({ toolName: "verifyProposal", args: { proposalId: referencedId }, summary: `hashValid=${v.hashValid}, ${matched}/${v.lines.length} prices matched.` });
    return {
      reply: `Proposal ${referencedId}: content hash ${v.hashValid ? "valid" : "INVALID"}; ${matched} of ${v.lines.length} frozen price(s) match a recorded Valio price.`,
      mode: "deterministic",
      toolCalls,
      activeProposal: await load(referencedId),
    };
  }

  // 3b. Status and history of a proposal.
  if (referencedId && /\b(status|audit|details|inspect|history|show)\b/i.test(input.message)) {
    const proposal = await getProposal(actor, referencedId);
    const events = await listAudit(actor.organizationId, { resourceType: "proposal", resourceId: referencedId, limit: 20 });
    toolCalls.push({ toolName: "getProposal", args: { proposalId: referencedId }, summary: `Status ${proposal.status}.` });
    return {
      reply: `Proposal ${proposal.id} is ${proposal.status}. ${nextStepMessage(proposal)}\nHistory:\n${events
        .reverse()
        .map((e) => `- ${e.createdAt} ${e.actorName ?? e.actorType}: ${e.summary}`)
        .join("\n")}`,
      mode: "deterministic",
      toolCalls,
      activeProposal: proposal,
    };
  }

  // 3c. Proactive stock-out alerts
  if (/\b(stock-?out|shortage|shortages|par\s+level|stock\s+alert)\b/i.test(msgLower)) {
    const alertsRes = await getProactiveStockoutAlerts(input.deliveryDate, user);
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
      activeProposal: null,
    };
  }

  // 3d. Proactive supplier recommendations
  if (/\b(recommend|recommendations|seasonal|new\s+arrival)\b/i.test(msgLower)) {
    const recRes = await getProactiveRecommendations(user);
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
      activeProposal: null,
    };
  }

  // 3e. Allergen-safe product substitutions lookup
  const subSkuMatch = /\b(substitut\w*|alternativ\w*)\b.*?\b(\d{5,8})\b/i.exec(input.message);
  if (subSkuMatch) {
    const targetSku = subSkuMatch[2]!;
    const subRes = await evaluateProductSubstitutions(
      { productId: targetSku, requestedQuantity: 100, deliveryDate: input.deliveryDate },
      user,
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
      activeProposal: null,
    };
  }

  // 3f. Inspect kitchen inventory or list recipes (without ordering)
  if (
    !/\b(buy|order|make|cook|prepare)\b/i.test(msgLower) &&
    /\b(inventory|kitchen\s+stock)\b/i.test(msgLower)
  ) {
    const inv = await listInventory(user);
    toolCalls.push({
      toolName: "getKitchenInventory",
      args: {},
      summary: `Loaded ${inv.items.length} kitchen inventory item(s).`,
    });
    return {
      reply: `Current kitchen inventory (${inv.items.length} items):\n${inv.items.map((i) => `- ${i.ingredientName}: ${i.quantityInStock} ${i.unit} (par: ${i.minParLevel ?? "N/A"})`).join("\n")}`,
      mode: "deterministic",
      toolCalls,
      activeProposal: null,
    };
  }

  if (
    !/\b(buy|order|make|cook|prepare)\b/i.test(msgLower) &&
    /\b(recipes|recipe\s+book|what\s+dishes)\b/i.test(msgLower)
  ) {
    const recipes = await listRecipes({}, user);
    toolCalls.push({
      toolName: "listRecipes",
      args: {},
      summary: `Found ${recipes.recipes.length} recipe(s).`,
    });
    return {
      reply: `Available recipes (${recipes.recipes.length}):\n${recipes.recipes.map((r) => `- ${r.name} (${r.id}, base ${r.baseServings} servings)`).join("\n")}`,
      mode: "deterministic",
      toolCalls,
      activeProposal: null,
    };
  }

  // 3g. Recipe → proposal (e.g. "Order products for salmon soup for 40 servings").
  if (/\b(recipe|salmon\s+soup|lohikeitto|potato\s+gratin|canteen\s+bake|cloudberry\s+quark\s+bowl|make|cook|prepare)\b/i.test(msgLower)) {
    const matchedRecipe = await findRecipeByDishQuery(input.message, user);
    if (matchedRecipe) {
      const servingsMatch = /(\d+(?:[.,]\d+)?)\s*(?:servings?|portions?|people|persons?)\b/i.exec(input.message);
      const servings = servingsMatch ? Number.parseFloat(servingsMatch[1]!.replace(",", ".")) : undefined;
      const res = await createProposalFromRecipe({ recipeId: matchedRecipe.id, servings, deliveryDate: input.deliveryDate }, user, true);
      toolCalls.push({
        toolName: "createProposalFromRecipe",
        args: { recipeId: matchedRecipe.id, servings: res.requestedServings, deliveryDate: input.deliveryDate },
        summary: res.message,
      });
      return { reply: `'${res.recipeUsed.name}' for ${res.requestedServings} servings: ${res.message}`, mode: "deterministic", toolCalls, activeProposal: res.proposal };
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

    const searchRes = await searchProducts({ q: cleanedQuery || undefined, limit: 5, offset: 0, sort: "relevance" });
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
        activeProposal: null,
      };
    }
  }

  // 5. Default: request → product selection → proposal (the purchasing flow decides what happens next).
  const created = await createProposalFromPrompt(actor, { prompt: input.message, date: input.deliveryDate });
  toolCalls.push({ toolName: "createProposalFromPrompt", args: { prompt: input.message, date: input.deliveryDate }, summary: created.message });
  const lines = created.proposal?.lines
    .map((l) => `${l.quantity} ${l.salesUnit ?? ""} of '${l.name}' (${l.productId}) = ${l.lineTotalExclVat?.toFixed(2) ?? "?"} EUR`)
    .join("; ");
  const warnings = created.selection.warnings.length ? ` Check: ${created.selection.warnings.join(" ")}` : "";
  return {
    reply: lines ? `${lines}. ${created.message}${warnings}` : created.message,
    mode: "deterministic",
    toolCalls,
    activeProposal: created.proposal,
  };
}
