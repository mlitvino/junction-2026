// Run: pnpm test:server
import assert from "node:assert/strict";
import { test } from "node:test";

import { correctWord, editDistance, parseSearchQuery, productWords, scoringName } from "./query.ts";

test("drops quantities, units and filler words; dietary words become filters", () => {
  const p = parseSearchQuery("100 litres of lactose-free milk");
  assert.deepEqual(p.terms, [["milk"]]);
  assert.deepEqual(p.dietary, ["lactose-free"]);
  assert.equal(p.text, "milk");

  assert.deepEqual(parseSearchQuery("2,5 kg butter").terms, [["butter"]]);
  assert.deepEqual(parseSearchQuery("12 x 1l cream").terms, [["cream"]]);
  assert.deepEqual(parseSearchQuery("gluten free bread").dietary, ["gluten-free"]);
  assert.deepEqual(parseSearchQuery("laktoositon maito").dietary, ["lactose-free"]);
  assert.deepEqual(parseSearchQuery("469330").terms, [["469330"]], "product ids and GTINs are kept");
});

test("plurals match their singular; Finnish food words also search the English name", () => {
  assert.deepEqual(parseSearchQuery("salmon fillets").terms, [["salmon"], ["fillets", "fillet"]]);
  assert.deepEqual(parseSearchQuery("voita").terms, [["voita", "butter"]]);
  assert.deepEqual(parseSearchQuery("maitoa").terms, [["maitoa", "milk"]]);
  assert.equal(parseSearchQuery("2 kg voita").scoringText, "butter");
  assert.equal(parseSearchQuery("juustoa").scoringText, "cheese");
});

test("typos are corrected to a known catalog word", () => {
  assert.equal(editDistance("mlik", "milk"), 1, "a swap is one edit");
  const vocabulary = new Map([["milk", 900], ["mild", 20], ["butter", 300], ["cheddar", 50]]);
  assert.equal(correctWord("mlik", vocabulary), "milk");
  assert.equal(correctWord("buttre", vocabulary), "butter");
  assert.equal(correctWord("chedar", vocabulary), "cheddar");
  assert.equal(correctWord("milk", vocabulary), null, "known words stay");
  assert.equal(correctWord("xyzzy", vocabulary), null, "nothing close");
  assert.equal(correctWord("mik", vocabulary), null, "too short to guess");
});

test("the agent's names keep dietary words but lose quantities; Finnish food words score in English", () => {
  assert.deepEqual(productWords("1,8 kg of lactose-free milk"), ["lactose", "free", "milk"]);
  assert.equal(scoringName("2 kg voita"), "butter");
  assert.equal(scoringName("Lactose-free milk"), "lactose free milk");
  assert.equal(scoringName("Salmon fillet"), "salmon fillet");
});
