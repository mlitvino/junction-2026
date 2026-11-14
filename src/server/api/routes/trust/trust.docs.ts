import "server-only";

import { createRoute } from "@hono/zod-openapi";

import { PublicKeyResponseSchema } from "@/shared/contracts/trust";

// OpenAPI definitions for trust endpoints. Handlers live in ./trust.ts.

export const getPublicKeyRoute = createRoute({
  method: "get",
  path: "/trust/public-key",
  tags: ["System"],
  summary: "Proposal-signing public key",
  description:
    "The Ed25519 public key that signs every proposal (`signature`, `signatureKeyId` on a proposal and its receipt). " +
    "To check a proposal yourself: build `message` from its `id` and `hash`, decode `signature` (base64url) and verify it with this key. " +
    "`GET /api/proposals/{id}/verify` does the same on the server. No authentication.",
  responses: {
    200: { description: "The current key.", content: { "application/json": { schema: PublicKeyResponseSchema } } },
  },
});
