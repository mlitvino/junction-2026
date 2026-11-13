import { z } from "zod";

/** GET /api/health — response */
export const HealthResponseSchema = z.object({
  status: z.literal("ok").meta({ description: "Always `ok` when the API is up." }),
  time: z.iso.datetime().meta({
    description: "Server time (ISO 8601, UTC) when the response was produced.",
    example: "2026-11-14T12:00:00.000Z",
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
