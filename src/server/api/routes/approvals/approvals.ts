import "server-only";

import { ProcurementError, decideApproval, listApprovals } from "@/server/services/procurement";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { decideApprovalRoute, listApprovalsRoute } from "./approvals.docs";

export const approvalsRouter = createRouter();

// Approvers only. Separate statements: `.use()` returns a plain Hono type (see routes/me/me.ts).
approvalsRouter.use("/approvals", requireRole("approver"));
approvalsRouter.use("/approvals/*", requireRole("approver"));

approvalsRouter.openapi(listApprovalsRoute, async (c) =>
  c.json(
    {
      items: await listApprovals(
        { organizationId: c.var.user.organization.id, userId: c.var.user.id },
        c.req.valid("query"),
      ),
    },
    200,
  ),
);

approvalsRouter.openapi(decideApprovalRoute, async (c) => {
  try {
    const proposal = await decideApproval(
      { organizationId: c.var.user.organization.id, userId: c.var.user.id },
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json(proposal, 200);
  } catch (err) {
    if (!(err instanceof ProcurementError)) throw err;
    const body = { error: err.message, code: err.code };
    return err.status === 404 ? c.json(body, 404) : c.json(body, 409);
  }
});
