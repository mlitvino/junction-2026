import "server-only";

import { and, desc, eq, type SQL } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { ensureDatabase } from "@/server/db/migrate";
import { auditEvent, type AuditEventRow } from "@/server/db/schema";
import type { AuditEvent, AuditQuery } from "@/shared/contracts/purchasing";

// Organization-wide audit log: an insert-only, human-readable record of what happened and why.
// Writers pass the transaction they already run in, so the record and the change commit together.

type Writer = Pick<ReturnType<typeof getDb>, "insert">;

/** Who did it. An agent always acts for a signed-in user, whose id is kept as the actor id. */
export type AuditActor = {
  organizationId: string;
  userId: string | null;
  userName: string | null;
  /** True when the purchasing agent acted (for `userId`), false for a person. */
  agent?: boolean;
};

export type AuditEntry = {
  action: string;
  resourceType: "proposal" | "approval" | "order" | "preferences" | "member";
  resourceId: string;
  summary: string;
  details?: Record<string, unknown>;
  /** Overrides the actor type, e.g. `system` for automatic checks. */
  actorType?: "user" | "agent" | "system";
};

export async function recordAudit(tx: Writer, actor: AuditActor, entries: AuditEntry | AuditEntry[]) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  // One transaction gives every row the same `now()`: stamp them one millisecond apart, ending now,
  // so a trail written in one go (the agent's steps) reads back in the order it happened.
  const end = Date.now();
  await tx.insert(auditEvent).values(
    list.map((e, i) => ({
      createdAt: new Date(end - (list.length - 1 - i)),
      organizationId: actor.organizationId,
      actorType: e.actorType ?? (actor.agent ? "agent" : "user"),
      actorId: e.actorType === "system" ? null : actor.userId,
      actorName: e.actorType === "system" ? "System" : actor.agent ? `Purchasing agent (for ${actor.userName ?? "user"})` : actor.userName,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      summary: e.summary,
      details: e.details ?? {},
    })),
  );
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actorType: row.actorType as AuditEvent["actorType"],
    actorId: row.actorId,
    actorName: row.actorName,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    summary: row.summary,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The organization's audit log, newest first; optionally for one resource. */
export async function listAudit(organizationId: string, query: AuditQuery): Promise<AuditEvent[]> {
  await ensureDatabase();
  const where: SQL[] = [eq(auditEvent.organizationId, organizationId)];
  if (query.resourceType) where.push(eq(auditEvent.resourceType, query.resourceType));
  if (query.resourceId) where.push(eq(auditEvent.resourceId, query.resourceId));
  const rows = await getDb()
    .select()
    .from(auditEvent)
    .where(and(...where))
    .orderBy(desc(auditEvent.createdAt))
    .limit(query.limit);
  return rows.map(toAuditEvent);
}

/** Records one change outside a running transaction (e.g. after a settings or member update). */
export async function auditChange(actor: AuditActor, entry: AuditEntry) {
  await ensureDatabase();
  await recordAudit(getDb(), actor, entry);
}
