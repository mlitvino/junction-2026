import "server-only";

import {
  PROPOSAL_MESSAGE_FORMAT,
  SIGNING_ALGORITHM,
  signingKey,
  signProposal,
  verifyProposalSignature,
  type SignedContent,
  type SigningKey,
} from "@/server/purchasing/signing";
import type { PublicKeyResponse } from "@/shared/contracts/trust";

// The server's proposal-signing key (Ed25519, derived from BETTER_AUTH_SECRET: no extra secret to
// manage) and its public half for GET /api/trust/public-key.

const DEV_SECRET = "insecure-dev-signing-secret";

let key: SigningKey | undefined;

function serverKey(): SigningKey {
  if (key) return key;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is required to sign proposals.");
  key = signingKey(secret || DEV_SECRET);
  return key;
}

/** Signs a new proposal: the signature and the id of the key that made it. */
export function signProposalContent(content: SignedContent): { signature: string; signatureKeyId: string } {
  const k = serverKey();
  return { signature: signProposal(k, content), signatureKeyId: k.keyId };
}

/** Null when unsigned; false when signed by another key or the content changed. */
export function checkProposalSignature(
  content: SignedContent,
  signature: string | null,
  signatureKeyId: string | null,
): boolean | null {
  if (!signature) return null;
  const k = serverKey();
  if (signatureKeyId !== k.keyId) return false;
  return verifyProposalSignature(k.publicKey, content, signature);
}

export function publicKeyInfo(): PublicKeyResponse {
  const k = serverKey();
  const jwk = k.publicKey.export({ format: "jwk" });
  return {
    algorithm: SIGNING_ALGORITHM,
    keyId: k.keyId,
    publicKeyPem: k.publicKey.export({ format: "pem", type: "spki" }).toString(),
    publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x! },
    message: PROPOSAL_MESSAGE_FORMAT,
    signatureEncoding: "base64url",
  };
}
