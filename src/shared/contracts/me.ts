import { z } from "zod";

/**
 * A user's role inside their organization. A user can hold several.
 * - buyer: searches products and places orders
 * - approver: approves buyers' orders, sets the organization's AI settings and manages its members
 */
export const RoleSchema = z.enum(["buyer", "approver"]).meta({
  description:
    "`buyer`: searches products and places orders. `approver`: approves buyers' orders, sets the organization's AI settings and manages its members.",
});

/** The organization a user belongs to (exactly one per user). */
export const OrganizationSchema = z.object({
  id: z.string().meta({ description: "Organization id." }),
  name: z.string().meta({ example: "alice's organization" }),
});

/** The signed-in user, as seen by the API. */
export const SessionUserSchema = z.object({
  id: z.string().meta({ description: "User id." }),
  username: z.string().meta({ description: "Login name (lowercase).", example: "alice" }),
  organization: OrganizationSchema,
  roles: z.array(RoleSchema).meta({
    description: "The user's roles in their organization.",
    example: ["buyer", "approver"],
  }),
});

/** GET /api/me — response */
export const MeResponseSchema = z.object({ user: SessionUserSchema });

export type Role = z.infer<typeof RoleSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type SessionUser = z.infer<typeof SessionUserSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
