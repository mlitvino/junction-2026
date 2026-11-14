# Checklist

What is done and what is left, per part. One line each: what, and why it matters.
Challenge core: lookup, inquiry → order at fixed prices, permissions and human approval. Optional: delivery/sustainability comparison, substitutions, audit trail.

State: one purchasing system after the merge of `dev-agent` (#6) and `feat/integrate-frontend` (#7). The prompt/recipe/agent pipeline ends in a normal proposal; one rule source (layered preferences); one order model (`proposal` → `approval` → `purchase_order`); organization-wide audit log; default-deny API.

## Fixed after the merge

- [x] Local databases that ran the old migration order: documented fix `pnpm db:reset && pnpm data:import` (README); rule "never renumber migrations" in AGENTS.md.
- [x] Anonymous access closed: default-deny on `/api`, role guards on every router, agent tools act as the signed-in user, request bodies can't override budgets, guardrails or preferences.
- [x] One `/api/orders`: orders come only from ordering a proposal; old prompt/approval/checkout/verify order routes removed (`/api/proposals/from-prompt`, `/from-recipe`, `/{id}/revise`, `/{id}/verify`, `/api/orders/{id}/receipt` instead).
- [x] One rule system: B's guardrails became preference settings (unit price and line caps, category and product lists, dietary restrictions); `/api/guardrails` removed.
- [x] One allergen vocabulary: names or GS1 codes, mapped in `shared/contracts/allergens.ts`.
- [x] Real allergen data in search; synthetic products got `SYN-` ids (they reused real codes, e.g. 460101 = peaches) and appear only when the real catalog is empty; no invented prices, stock, nutrition or labels for real products.
- [x] Docs describe the unified flow (AGENTS.md, src/server/AGENTS.md, PREFERENCES.md, README).

## Static API (backend, no AI)

Done
- [x] Products and offers (A): `GET /api/products`, `/api/products/{id}`, `/offer`, `POST /api/offers`. Core lookup on real Valio data.
- [x] Catalog search with allergen/dietary filters, product details, substitutions (B): `/api/catalog/*`. Agent-oriented lookup and exception handling.
- [x] Fixed-price inquiry (B): `POST /api/inquiries`. Structured price + availability answer for narrowed-down products.
- [x] Organizations, roles (buyer, approver) and members. Who may do what.
- [x] Layered preferences (A) and guardrails (B). Rules the decision applies (two systems, see above).
- [x] Policy check `POST /api/policy/evaluate`, incl. availability (A). Guardrails model with reasons.
- [x] Proposals, approvals, orders with hash binding, idempotent orders, 24 h quote and order-time re-check (A). Inquiry → commitment at fixed prices.
- [x] Order lifecycle with approval, checkout, receipt (B). Same goal, prompt-driven.
- [x] Audit events per order + `GET /api/orders/{id}/audit` and trust-claim `GET /api/orders/{id}/verify` (B). Readable record and verifiable claims, for B's orders only.
- [x] Recipes, inventory and intelligence (stock-out alerts, recurring-order drift check, proactive recommendations) (B). Challenge example scenarios.
- [x] Unit tests in CI (`pnpm test`). Rules can't silently break.

Left
- [x] Unify A and B: one order model, one rule source, one approval flow.
- [ ] Agent identity: per-agent API keys created/revoked by approvers, scopes, every call attributed. The challenge is about external agents; today it's human sessions or anonymous.
- [x] Organization-wide audit log: `GET /api/audit`, `GET /api/proposals/{id}/audit` (selection steps, policy, approval, order, refusals, preference and member changes).
- [x] Usernames in proposal/approval/order responses (`createdByName`, `requestedByName`, `decidedByName`).
- [ ] Quantities in real units: content volume/weight per product + conversion ("1,000 L" → cases). Today the agent orders the requested number in sales units and flags the mismatch as a proposal warning.
- [ ] Filters and sorting on A's `GET /api/products` (or drop it for B's search after unifying). Agents must narrow down before asking Valio for prices.
- [ ] Comparison/ranking: good-better-best on price, reliability, CO2, preferred origin/vendor/brand, with reasons. Delivery and sustainability comparison.
- [ ] Policy rule "substitute outside preferences needs approval". `allowSubstitutes` exists but nothing enforces it.
- [ ] Import nutrition (`nutritionFact`) and labels (`packagingMarkedLabel`) from products.json, and the allergen `CONTAINS`/`MAY_CONTAIN` qualifier. Today real products show no nutrition or labels, and "may contain" counts as "contains".
- [ ] Partial availability: split lines when stock is short. "Response logic" for partial stock.
- [x] Proposal verification: `GET /api/proposals/{id}/verify` (hash + frozen prices matched to recorded Valio snapshots).
- [ ] Snapshot id on every price/stock answer and signed proposal hashes. Stronger trust protocol.
- [ ] Approval expiry and a pending-count endpoint for a badge. Approvals shouldn't wait forever or go unnoticed.
- [ ] Apply migrations without restarting the dev server (`ensureDatabase` runs once per process). Teammates get 500s after pulling a migration.
- [ ] Remove the `server/valio/types.ts` re-export shim. Legacy indirection.
- [ ] Stretch: MCP-style interface over the endpoints. Makes the API directly agent-readable.

## Frontend

Done
- [x] Real sign-in, user, organization and roles from `GET /api/me`. Screens per role.
- [x] Demo scenarios use real catalog products, prices and availability. No synthetic prices in connected mode.
- [x] Demo scenarios use the real policy decision. Limits come from the organization's preferences.

Left
- [ ] Switch the purchasing flow to `/api/proposals` (incl. `from-prompt`), `/api/approvals`, `/api/orders` (map EUR excl. VAT, statuses, hash-bound approvals). Approvals then work across browsers and users.
- [ ] UI for agent run, recipes, inventory, intelligence, audit and verify. The features are invisible in the UI.
- [ ] Manual buyer flow: search, pick quantities, policy preview, create proposal/order. Replaces the scripted scenarios.
- [ ] Handle `QUOTE_EXPIRED`, `PRICE_CHANGED`, `AVAILABILITY_CHANGED` and show `quoteExpiresAt`. Users must know to create a new proposal.
- [ ] Label VAT: the policy limit is excl. VAT, screens show incl. VAT. Otherwise correct numbers look like a bug.
- [ ] Preferences/guardrails screen, members screen. Backend exists; nobody can change settings without curl.
- [ ] Audit page and per-order timeline on real data. Shows what happened and why.
- [ ] Agent keys screen (after the backend). Approvers create and revoke agent access.
- [ ] Remove connected-mode scenario glue (`real-catalog.ts`, `realScenarioFixture`, hand-made litres table) after the switch. Legacy once real flows are used.
- [ ] Rename or remove the "Within the demo limit" scenario label. Default preferences now require approval.
- [ ] Fix `docs/INTEGRATION-STATUS.md` contradictions and old `/api/v1/...` paths. Docs must match the real API.
- [ ] Optional: naming procurement vs purchasing. The UI says procurement; the API now has both.
- [ ] Remove unused `src/client/provisional/unavailable-service.ts`. Dead code.

## Agent (AI)

Done
- [x] Mastra set up; Gemini when `GOOGLE_GENERATIVE_AI_API_KEY` is set, mock model otherwise. Builds and CI need no key.
- [x] Agent turn endpoint `POST /api/agent/run` with tools: search, product details, price/availability inquiry, manage orders, recipes/inventory, intelligence. The agent can act end to end.
- [x] Free-text extraction `POST /api/extract` and order-change agent. "1,000 L milk by Monday" → structured items.
- [x] Search tool on the real catalog; synthetic products only without a real catalog.

Left
- [ ] Streamed chat events for the UI (status, message, intent, proposal, approval, order). `/agent/run` returns one turn; the frontend's chat expects a stream.
- [x] The agent acts for the signed-in buyer through the one guarded flow; it can't approve or bypass the rules.
- [ ] Agent identity and scopes (API keys) for external agents.
- [ ] Decision-maker for missing data (unknown allergens, CO2) and good-better-best choice with explanations. Deliberately left out of the policy check.
- [x] One set of rules: the agent's candidate filter and the policy both read the layered preferences.
- [ ] Use `language`, `allowSubstitutes` and preferred origin/vendor/brand in the agent's ranking and answers.
- [ ] Write reasoning into the organization-wide audit log. "Readable record of what the agent did and why".
- [ ] Allergen-safe substitution under pressure with real GS1 data (see "Real allergen data ignored"). School/hospital scenario.
