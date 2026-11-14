import { z } from "zod";

/** Error body returned by the API for 401, 404 and 500 responses. */
export const ErrorResponseSchema = z.object({
  error: z.string().meta({ description: "Human-readable error message.", example: "Unauthorized" }),
});

/** 502 / 503 from the agent endpoints: the model failed, or the agent isn't configured on the server. */
export const AgentErrorResponseSchema = ErrorResponseSchema.extend({
  code: z.enum(["AGENT_NOT_CONFIGURED", "MODEL_FAILED"]).meta({
    description: "`AGENT_NOT_CONFIGURED` (503): no Gemini key on the server. `MODEL_FAILED` (502): the model call failed; retry.",
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type AgentErrorResponse = z.infer<typeof AgentErrorResponseSchema>;
