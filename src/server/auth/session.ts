import "server-only";

import type { SessionUser } from "@/shared/contracts/me";

import { getAuth } from "./auth";
import { ensureAuthSchema } from "./migrate";

/** The signed-in user for these request headers (session cookie), or null. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  await ensureAuthSchema();
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  return { id: session.user.id, username: session.user.username ?? session.user.name };
}
