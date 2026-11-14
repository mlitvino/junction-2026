import "server-only";

import { purchasingAgent } from "@/server/agents/purchasing-agent";
import { getMastra } from "@/server/mastra";
import { createPriceAvailabilityInquiry, searchCatalogProducts } from "@/server/services/inquiry";
import {
  checkoutOrder,
  createOrderFromPrompt,
  getOrderDetail,
  listOrders,
  modifyOrder,
} from "@/server/services/orders";
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

    const contextualMessage = [
      referencedOrderId ? `Active orderId context: ${referencedOrderId}` : null,
      input.deliveryDate ? `Target deliveryDate: ${input.deliveryDate}` : null,
      `Buyer message: ${input.message}`,
    ]
      .filter(Boolean)
      .join("\n");

    const beforeOrders = await listOrders(actor);
    const beforeLatestId = beforeOrders.orders[0]?.orderId ?? null;

    const result = await agent.generate(contextualMessage, {
      maxSteps: 6,
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

  // 3. Inspect / status / audit intent on an active order
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
