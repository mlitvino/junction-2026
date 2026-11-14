import "server-only";

import type { SessionUser } from "@/shared/contracts/me";

import { getAuth } from "./auth";
import { ensureAuthSchema } from "./migrate";
import { getOrCreateMembership } from "./roles";

/** The signed-in user for these request headers (session cookie) with their organization and roles, or null. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  await ensureAuthSchema();
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const username = session.user.username ?? session.user.name;
  const { organization, roles } = await getOrCreateMembership(session.user.id, username);
  return { id: session.user.id, username, organization, roles };
}
