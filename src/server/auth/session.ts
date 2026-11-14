import "server-only";

import { ensureDatabase } from "@/server/db/migrate";
import type { SessionUser } from "@/shared/contracts/me";

import { getAuth } from "./auth";
import { getOrCreateMembership } from "./roles";

/** The signed-in user for these request headers (session cookie) with their organization and roles, or null. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  // No session cookie, no session: answer without touching the database (fast 401s).
  if (!headers.get("cookie")?.includes("better-auth.session_token")) return null;
  await ensureDatabase();
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const username = session.user.username ?? session.user.name;
  const { organization, roles } = await getOrCreateMembership(session.user.id, username);
  return { id: session.user.id, username, organization, roles };
}
