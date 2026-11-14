import { z } from "zod";

// Trust: the server's public key for checking proposal signatures without asking the server.

export const PublicKeyResponseSchema = z.object({
  algorithm: z.literal("Ed25519"),
  keyId: z.string().meta({ description: "Matches `signatureKeyId` on proposals this key signed.", example: "3f9a1c0b7d2e4a51" }),
  publicKeyPem: z.string().meta({ description: "SPKI PEM." }),
  publicKeyJwk: z.object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string() }),
  message: z.string().meta({
    description:
      "What is signed, UTF-8, lines joined by \\n: `trusted-trade/proposal/v1`, the proposal `id`, its `hash`.",
    example: "trusted-trade/proposal/v1\\n<proposalId>\\n<hash>",
  }),
  signatureEncoding: z.literal("base64url"),
});

export type PublicKeyResponse = z.infer<typeof PublicKeyResponseSchema>;
