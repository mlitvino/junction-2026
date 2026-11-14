import { z } from "zod";

/** The signed-in user, as seen by the API. */
export const SessionUserSchema = z.object({
  id: z.string().meta({ description: "User id." }),
  username: z.string().meta({ description: "Login name (lowercase).", example: "alice" }),
});

/** GET /api/me — response */
export const MeResponseSchema = z.object({ user: SessionUserSchema });

export type SessionUser = z.infer<typeof SessionUserSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
