import "server-only";

import { listAudit } from "@/server/services/audit";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { listAuditRoute } from "./audit.docs";

export const auditRouter = createRouter();

// Approvers only. Separate statement: `.use()` returns a plain Hono type (see routes/me/me.ts).
auditRouter.use("/audit", requireRole("approver"));

auditRouter.openapi(listAuditRoute, async (c) =>
  c.json({ items: await listAudit(c.var.user.organization.id, c.req.valid("query")) }, 200),
);
