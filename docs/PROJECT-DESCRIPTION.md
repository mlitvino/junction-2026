# LUUKKU: trusted purchasing agents for Valio Aimo

A professional kitchen says "Order 100 litres of lactose-free milk for Friday". LUUKKU turns that sentence into a priced, policy-checked, human-approved and verifiable order. One flow, driven by a person or an outside AI agent through the same documented API.

## How it works
- **Understands the request.** It extracts product, type and quantity from free text, recipes or follow-ups ("change X to Y").
- **Finds the right product in the real Valio catalog** (17,500 products). It matches names first, filters out lookalikes (no coffee milk for "milk"), and applies dietary and allergen rules.
- **Converts units properly.** "100 litres" becomes 100 one-litre packs, and "1000 L" becomes 200 cases of 5 L, not 1000 cases.
- **Ranks good / better / best with reasons.** The weights are price per litre or kilo (35%), availability by the delivery date (25%), and relevance, delivery reliability, CO2 and preferred origin, vendor or sustainability labels (10% each). Every choice says why ("€1.01/L, cheapest").
- **Fixes prices with the live Valio API.** Only matching products are priced (respecting rate limits); each answer is stored as a snapshot with an id.
- **Builds a proposal.** It is a frozen order preview: lines, prices, total, policy decision and a SHA-256 hash, valid for 24 h.

## Guardrails and human approval
- **Organization rules** in three layers (organization, buyer, approver) with locks. They cover spending limits, auto-approval, price and quantity caps, blocked vendors and products, allergens, CO2, reliability and substitutes.
- **Every proposal is decided** ALLOW, REQUIRE_APPROVAL or DENY, with readable reasons. The agent may order only what the rules allow, and it can never approve.
- **Approvals are bound to the exact hash the approver reviewed.** They expire with the quote.
- **At order time the server re-checks Valio.** If a price or availability changed, the order is refused. Orders are idempotent, so a double click never orders twice.

## Trust you can check
- **Every proposal is signed (Ed25519).** Anyone can verify it offline with the public key at /api/trust/public-key.
- **/verify recomputes the hash** and matches every frozen price to the recorded Valio answer it came from.
- **A human-readable audit trail** records what the agent searched, filtered, ranked and chose, who approved and what was ordered, in order.

## Beyond the core
- **Recipe-to-order:** scale a recipe (e.g. salmon soup), subtract kitchen stock, and order only what is missing.
- **Partial stock:** a short line is split over compliant alternatives, and the split is marked as a substitute.
- **Substitutes:** allergen- and diet-safe alternatives; swaps keep the buyer's edited quantity.
- **Delivery and sustainability comparison:** lead time against the deadline, reliability, CO2 per kg, and labels such as Hyvää Suomesta or EU organic.
- **Proactive help:** stock-out alerts, recurring-order anomaly checks and recommendations.

## Open interface for external agents
- **Every capability is a REST endpoint**, with an OpenAPI 3.1 spec and Swagger UI generated from shared Zod contracts.
- **The conversational agent** (Gemini through Mastra) uses the same functions as tools.
- **Clear error codes:** APPROVAL_REQUIRED, PRICE_CHANGED, AGENT_NOT_CONFIGURED and others, so an agent always knows what to do next.

## Engineering quality
- **Default-deny API** with roles (buyer, approver); every query is scoped to the organization.
- **Pure, unit-tested rules** for policy, ranking, units, signing and purchasing.
- **9 end-to-end scenarios (about 50 tests)** run in CI against a production build with the real catalog: sign-up → approval → order → audit.
- **CI/CD to a Hetzner server** and a deterministic test mode without an LLM key.

LUUKKU shows that an AI agent can buy on a company's behalf safely. It is fast where the rules allow, it stops for a human where they don't, and it leaves proof of every step.
