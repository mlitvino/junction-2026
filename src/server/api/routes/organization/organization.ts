import "server-only";

import { auditChange } from "@/server/services/audit";
import { actorFor } from "@/server/services/purchasing";

import {
  OrganizationError,
  createMember,
  listMembers,
  updateMemberRoles,
} from "@/server/services/organization";
import { MemberSchema, MembersResponseSchema } from "@/shared/contracts/organization";

import { requireRole } from "../../middleware/session";
import { createRouter } from "../../router";
import { createMemberRoute, listMembersRoute, updateMemberRolesRoute } from "./organization.docs";

export const organizationRouter = createRouter();

// Approvers of an organization manage its members. Separate statement: `.use()` returns a plain Hono
// type, so chaining `.openapi()` after it doesn't type-check (same as routes/me/me.ts).
organizationRouter.use("/organization/*", requireRole("approver"));

organizationRouter
  .openapi(listMembersRoute, async (c) =>
    c.json(MembersResponseSchema.parse({ members: await listMembers(c.var.user.organization.id) }), 200),
  )
  .openapi(createMemberRoute, async (c) => {
    try {
      const member = await createMember(c.var.user.organization.id, c.req.valid("json"));
      await auditChange(actorFor(c.var.user), {
        action: "member.created",
        resourceType: "member",
        resourceId: member.userId,
        summary: `Created member ${member.username} with roles ${member.roles.join(", ")}.`,
      });
      return c.json(MemberSchema.parse(member), 201);
    } catch (err) {
      if (err instanceof OrganizationError && err.status === 409) return c.json({ error: err.message }, 409);
      throw err;
    }
  })
  .openapi(updateMemberRolesRoute, async (c) => {
    try {
      const { roles } = c.req.valid("json");
      const member = await updateMemberRoles(c.var.user.organization.id, c.req.valid("param").userId, roles);
      await auditChange(actorFor(c.var.user), {
        action: "member.roles_changed",
        resourceType: "member",
        resourceId: member.userId,
        summary: `Set ${member.username}'s roles to ${member.roles.join(", ")}.`,
      });
      return c.json(MemberSchema.parse(member), 200);
    } catch (err) {
      if (!(err instanceof OrganizationError)) throw err;
      return err.status === 404 ? c.json({ error: err.message }, 404) : c.json({ error: err.message }, 409);
    }
  });
