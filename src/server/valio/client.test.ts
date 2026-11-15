// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import { transientRetryDelay } from "./client.ts";

test("retries transient Valio failures once, never request errors or timeouts", () => {
  assert.equal(transientRetryDelay(null, null), 800, "connection refused/reset");
  assert.equal(transientRetryDelay(503, null), 800);
  assert.equal(transientRetryDelay(429, "2"), 2000, "honours Retry-After");
  assert.equal(transientRetryDelay(429, "60"), 5000, "capped at 5 s");
  assert.equal(transientRetryDelay(422, null), null, "a bad request stays bad");
  assert.equal(transientRetryDelay(401, null), null);
  assert.equal(transientRetryDelay(null, null, true), null, "a timeout already waited 10 s");
});
