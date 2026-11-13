import { z } from "zod";

/** GET /api/health — response */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
