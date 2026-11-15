// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import { toPlainReply } from "./plain-text.ts";

test("strips headings, bold, italic and inline code", () => {
  assert.equal(
    toPlainReply("## Proposal ready\n\nI created **3 lines** for *tomorrow*; id `abc-123`."),
    "Proposal ready\n\nI created 3 lines for tomorrow; id abc-123.",
  );
});

test("bullets become '- ' lines and nested indentation is flattened", () => {
  assert.equal(toPlainReply("* Milk\n  * Whole\n+ Cream"), "- Milk\n- Whole\n- Cream");
});

test("numbered lists stay numbered", () => {
  assert.equal(toPlainReply("1. First\n2) Second"), "1. First\n2) Second");
});

test("links keep their target, images keep their alt text", () => {
  assert.equal(
    toPlainReply("See [the receipt](/api/orders/1/receipt) ![logo](x.png)"),
    "See the receipt (/api/orders/1/receipt) logo",
  );
});

test("tables become one list line per row", () => {
  const md = "| Product | Qty | Price |\n| --- | ---: | --- |\n| Milk 1 L | 200 | 1.20 EUR |\n| Cream | 10 | 3.50 EUR |";
  assert.equal(toPlainReply(md), "- Milk 1 L: Qty 200, Price 1.20 EUR\n- Cream: Qty 10, Price 3.50 EUR");
});

test("code fences and horizontal rules are removed, blank lines collapsed", () => {
  assert.equal(toPlainReply("Intro\n\n---\n\n\n\n```\nGET /api/x\n```\n"), "Intro\n\nGET /api/x");
});

test("snake_case and multiplication stars are left alone", () => {
  assert.equal(toPlainReply("price_per_kg is 2 * 3 = 6"), "price_per_kg is 2 * 3 = 6");
});

test("plain text passes through unchanged", () => {
  const text = "Placed simulated order 1 (12.00 EUR excl. VAT).\nHistory:\n- 2026-11-15 buyer: created";
  assert.equal(toPlainReply(text), text);
});
