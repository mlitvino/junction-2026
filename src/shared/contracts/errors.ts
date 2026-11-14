import { z } from "zod";

/** Error body returned by the API for 401, 404 and 500 responses. */
export const ErrorResponseSchema = z.object({
  error: z.string().meta({ description: "Human-readable error message.", example: "Unauthorized" }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
