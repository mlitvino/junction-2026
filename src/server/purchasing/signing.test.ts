// Run: pnpm test:server
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { test } from "node:test";

import { keyIdOf, signingKey, signProposal, verifyProposalSignature } from "./signing.ts";

const content = { proposalId: "p-1", hash: "a".repeat(64) };

test("the same secret gives the same key; another secret another key", () => {
  const a = signingKey("secret-one");
  assert.equal(signingKey("secret-one").keyId, a.keyId);
  assert.notEqual(signingKey("secret-two").keyId, a.keyId);
  assert.match(a.keyId, /^[0-9a-f]{16}$/);
});

test("a signature verifies with the published public key only for unchanged content", () => {
  const key = signingKey("secret-one");
  const signature = signProposal(key, content);
  // What an outside agent does: rebuild the key from the published PEM.
  const pem = key.publicKey.export({ format: "pem", type: "spki" }).toString();
  const published = createPublicKey(pem);
  assert.equal(keyIdOf(published), key.keyId);
  assert.equal(verifyProposalSignature(published, content, signature), true);
  assert.equal(verifyProposalSignature(published, { ...content, hash: "b".repeat(64) }, signature), false);
  assert.equal(verifyProposalSignature(published, { ...content, proposalId: "p-2" }, signature), false);
  assert.equal(verifyProposalSignature(signingKey("secret-two").publicKey, content, signature), false);
  assert.equal(verifyProposalSignature(published, content, "not-a-signature"), false);
});
