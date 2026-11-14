import "server-only";

import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify, type KeyObject } from "node:crypto";

// Ed25519 signatures over proposal hashes. The server signs every new proposal; anyone with the
// public key (GET /api/trust/public-key) can check, offline, that a proposal id + content hash
// really came from this server and wasn't changed. Pure (no DB, no env): the service passes the
// secret, `pnpm test:server` tests it.
//
// The key is derived from a server secret (HKDF-SHA256 → 32-byte Ed25519 seed), so there is no
// extra key to manage. Rotating the secret rotates the key; `keyId` records which key signed.

export const SIGNING_ALGORITHM = "Ed25519";
export const PROPOSAL_MESSAGE_FORMAT = "trusted-trade/proposal/v1\\n<proposalId>\\n<hash>";

const SEED_INFO = "proposal-signing-v1";
// PKCS#8 wrapper for a raw Ed25519 private key (RFC 8410): the 32-byte seed follows this prefix.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type SigningKey = { privateKey: KeyObject; publicKey: KeyObject; keyId: string };
export type SignedContent = { proposalId: string; hash: string };

export function signingKey(secret: string): SigningKey {
  if (!secret) throw new Error("A signing secret is required.");
  const seed = Buffer.from(hkdfSync("sha256", secret, "junction-2026", SEED_INFO, 32));
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, keyId: keyIdOf(publicKey) };
}

/** First 16 hex chars of SHA-256 over the raw 32-byte public key. */
export function keyIdOf(publicKey: KeyObject): string {
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** The exact bytes that are signed (see PROPOSAL_MESSAGE_FORMAT). */
export function proposalMessage({ proposalId, hash }: SignedContent): Buffer {
  return Buffer.from(`trusted-trade/proposal/v1\n${proposalId}\n${hash}`, "utf8");
}

/** Base64url Ed25519 signature. */
export function signProposal(key: SigningKey, content: SignedContent): string {
  return sign(null, proposalMessage(content), key.privateKey).toString("base64url");
}

export function verifyProposalSignature(publicKey: KeyObject, content: SignedContent, signature: string): boolean {
  try {
    return verify(null, proposalMessage(content), publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
