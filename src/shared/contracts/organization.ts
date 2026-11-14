import { z } from "zod";

import { RoleSchema } from "./me";

// Member management of the caller's organization (approver only).

const roles = z
  .array(RoleSchema)
  .min(1)
  .meta({ description: "At least one role. A user can hold several.", example: ["buyer"] });

export const MemberSchema = z.object({
  userId: z.string(),
  username: z.string().meta({ example: "bob" }),
  roles: z.array(RoleSchema),
});

/** GET /api/organization/members — response */
export const MembersResponseSchema = z.object({ members: z.array(MemberSchema) });

/** POST /api/organization/members — creates an account inside the caller's organization. */
export const CreateMemberRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.]+$/, "Letters, digits, underscore and dot only")
    .meta({ description: "Login name for the new account.", example: "bob" }),
  password: z.string().min(2).meta({ description: "Initial password (min. 2 characters)." }),
  roles,
});

/** PUT /api/organization/members/{userId}/roles — replaces the member's roles. */
export const UpdateRolesRequestSchema = z.object({ roles });

export type Member = z.infer<typeof MemberSchema>;
export type MembersResponse = z.infer<typeof MembersResponseSchema>;
export type CreateMemberRequest = z.infer<typeof CreateMemberRequestSchema>;
export type UpdateRolesRequest = z.infer<typeof UpdateRolesRequestSchema>;
