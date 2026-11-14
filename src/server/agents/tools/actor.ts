import "server-only";

import type { SessionUser } from "@/shared/contracts/me";

/** Key under which `runPurchasingAgent` puts the signed-in user into the agent's request context. */
export const ACTOR_KEY = "actor";

type ToolContext = { requestContext?: { get: (key: string) => unknown } } | undefined;

/**
 * The signed-in user a tool acts for. Tools never act anonymously: the agent route requires a
 * session and passes the user in the request context (services/agent.ts).
 */
export function toolActor(context: ToolContext): SessionUser {
  const actor = context?.requestContext?.get(ACTOR_KEY) as SessionUser | undefined;
  if (!actor) throw new Error("This tool needs the signed-in user; run it through POST /api/agent/run.");
  return actor;
}
