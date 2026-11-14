import "server-only";

import { RequestContext } from "@mastra/core/request-context";

import { assertGeminiConfigured } from "@/server/agents/gemini";
import { purchasingAgent } from "@/server/agents/purchasing-agent";
import { getMastra } from "@/server/mastra";
import { getOrderDetail, listOrders } from "@/server/services/orders";
import { getEffectiveFor } from "@/server/services/preferences";
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
 * Executes an autonomous turn of the Valio Aimo Purchasing Agent via Mastra `purchasingAgent` (Gemini)
 * with multi-step tool calling. Requires `GOOGLE_GENERATIVE_AI_API_KEY`.
 */
export async function runPurchasingAgent(
  input: AgentRunRequest,
  actor?: SessionUser | null,
): Promise<AgentRunResponse> {
  assertGeminiConfigured();

  const referencedOrderId = input.orderId ?? extractOrderIdFromMessage(input.message);
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
      "toolName" in payload && typeof payload.toolName === "string" ? payload.toolName : "unknown";
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
