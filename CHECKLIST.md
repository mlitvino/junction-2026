# Checklist

What is done and what is left, per part. One line each: what, and why it matters.
Challenge core: lookup, inquiry → order at fixed prices, permissions and human approval. Optional: delivery/sustainability comparison, substitutions, audit trail.

State: one purchasing system after the merges of `dev-agent` (#6, #8) and `feat/integrate-frontend` (#7) and the unification commits. Since #8 the agent needs Gemini unless `TEST_MODE=TRUE`. Prompts, recipes and the agent end in a normal proposal; one rule source (layered preferences); one order model (`proposal` → `approval` → `purchase_order`); organization-wide audit log; default-deny API. `pnpm check` and `pnpm test` pass.

## Before pushing to `main` (deploys)

- [ ] Production `.env` on the server has `GOOGLE_GENERATIVE_AI_API_KEY` (or `TEST_MODE=TRUE` for a demo without Gemini). Since #8, `/api/agent/run`, `/api/extract` and `/api/proposals/from-prompt` fail without one of them.
- [ ] Local `.env`: same choice. The live check script's agent step expects the deterministic flow, so run it with `TEST_MODE=TRUE`.
- [ ] Tell the frontend dev about the contract changes: `agent` (`proposalId`, `activeProposal`), recipe response (`proposal`, `selection`, `message`), `intelligence` recurring check (`proposalId`), `catalog` nutrition nullable, removed `orders.ts`/`guardrails.ts` contracts, new `selection.ts`/`allergens.ts`. Nothing in the UI uses them yet, but the next integration will.

## Static API (backend, no AI)

Done
- [x] Products and offers: `GET /api/products`, `/api/products/{id}`, `/offer`, `POST /api/offers`. Core lookup on real Valio data.
- [x] Catalog search with allergen (names or GS1) and dietary filters, product details, substitutions: `/api/catalog/*`. Agent-oriented lookup and exception handling.
- [x] Fixed-price inquiry: `POST /api/inquiries`. Structured price + availability answer for narrowed-down products.
- [x] Organizations, roles (buyer, approver) and members. Who may do what.
- [x] Layered preferences, incl. the former guardrails (unit price and line caps, category and product lists, dietary restrictions). One rule source.
- [x] Policy check `POST /api/policy/evaluate`, incl. availability and the new caps/lists. Guardrails model with reasons.
- [x] Proposals, approvals, orders: hash binding, idempotent orders, 24 h quote, order-time price re-check. Inquiry → commitment at fixed prices.
- [x] Agent-made proposals: `/api/proposals/from-prompt`, `/from-recipe`, `/{id}/revise`, with the selection trace and warnings on the proposal. Same rules as any proposal.
- [x] Organization-wide audit log: `GET /api/audit`, `GET /api/proposals/{id}/audit` (selection steps, policy, approval, order, refused orders, preference and member changes). Readable record of what happened and why.
- [x] Proposal verification `GET /api/proposals/{id}/verify` and receipts `GET /api/orders/{id}/receipt`. Claims checkable without a manual lookup.
- [x] Usernames in proposal, approval and order responses. Approvers see "alice", not an id.
- [x] Default-deny API, role guards everywhere, no rule overrides in request bodies. No anonymous access to organization data.
- [x] Catalog data honesty: synthetic products only with `SYN-` ids and only without a real catalog; no invented prices, stock, nutrition or labels.
- [x] Recipes, inventory and intelligence (stock-out alerts, recurring-order drift check, proactive recommendations) on the unified flow. Challenge example scenarios.
- [x] Partial stock: `autoResolvePartialStock` splits a line over compliant alternatives. "Response logic" for partial stock.
- [x] Unit tests in CI (`pnpm test`). Rules can't silently break.

Left
- [ ] Agent identity: per-agent API keys created/revoked by approvers, scopes, every call attributed. The challenge is about external agents; today only signed-in people (and the agent acting for them) can call the API.
- [ ] Quantities in real units: content volume/weight per product + conversion ("1,000 L" → cases). Today the agent orders the requested number in sales units and flags the mismatch as a proposal warning.
- [ ] One product search: `GET /api/products` (A) and `GET /api/catalog/products` (B) overlap; keep one, with filters (origin, max CO2, min reliability, vendor, brand) and sorting. Agents must narrow down before asking Valio for prices.
- [ ] Comparison/ranking endpoint: good-better-best on price, reliability, CO2, preferred origin/vendor/brand, with reasons. Delivery and sustainability comparison.
- [ ] Policy rule "substitute outside preferences needs approval". `allowSubstitutes` exists but nothing enforces it.
- [ ] Import nutrition (`nutritionFact`), labels (`packagingMarkedLabel`) and the allergen `CONTAINS`/`MAY_CONTAIN` qualifier from products.json. Today real products show no nutrition or labels, and "may contain" counts as "contains".
- [ ] Snapshot id on every price/stock answer and signed proposal hashes. Stronger trust protocol.
- [ ] Approval expiry and a pending-count endpoint for a badge. Approvals shouldn't wait forever or go unnoticed.
- [ ] Apply migrations without restarting the dev server (`ensureDatabase` runs once per process). Teammates get 500s after pulling a migration.
- [ ] Remove the `server/valio/types.ts` re-export shim. Legacy indirection.
- [ ] Retired tables (`procurement_order`, `procurement_audit_event`, `organization_procurement_settings`) stay unused; drop them only in a later cleanup once rollbacks to old images are no longer needed. Migrations are additive.
- [ ] Map agent configuration and model errors to a clear response: a missing `GOOGLE_GENERATIVE_AI_API_KEY` throws a plain `Error`, and since #8 a failed model call in extraction or proposal revision is no longer caught, so both become `500 Internal error`. Return e.g. 503 "agent not configured" / 502 "model failed" with a message.
- [ ] README "LLM (Gemini)" still says the agent falls back to a mock model without a key; since #8 it requires the key unless `TEST_MODE=TRUE`. Update README and the root AGENTS.md agent notes.
- [ ] Stretch: MCP-style interface over the endpoints. Makes the API directly agent-readable.

## Frontend

Done
- [x] Real sign-in, user, organization and roles from `GET /api/me`. Screens per role.
- [x] Demo scenarios use real catalog products, prices and availability. No synthetic prices in connected mode.
- [x] Demo scenarios use the real policy decision. Limits come from the organization's preferences.

Left
- [ ] Switch the purchasing flow to `/api/proposals` (incl. `from-prompt`), `/api/approvals`, `/api/orders` (map EUR excl. VAT, statuses, hash-bound approvals, no intent). Approvals then work across browsers and users.
- [ ] Manual buyer flow: search, pick quantities, policy preview, create proposal/order. Replaces the scripted scenarios.
- [ ] Show the agent's `selection` (why each product) and its `warnings` on a proposal. The unit warning matters until quantities are converted.
- [ ] Handle `QUOTE_EXPIRED`, `PRICE_CHANGED`, `AVAILABILITY_CHANGED` and show `quoteExpiresAt`. Users must know to create a new proposal.
- [ ] Label VAT: the policy limit is excl. VAT, screens show incl. VAT. Otherwise correct numbers look like a bug.
- [ ] Preferences screen (incl. the new caps, category/product lists, dietary restrictions) and members screen. Backend exists; nobody can change settings without curl.
- [ ] Audit page (`/api/audit`) and per-proposal timeline (`/api/proposals/{id}/audit`) on real data. Shows what happened and why.
- [ ] UI for agent run, recipes, inventory and intelligence. The features are invisible in the UI.
- [ ] Agent keys screen (after the backend). Approvers create and revoke agent access.
- [ ] Remove connected-mode scenario glue (`real-catalog.ts`, `realScenarioFixture`, hand-made litres table) after the switch. Legacy once real flows are used.
- [ ] Rename or remove the "Within the demo limit" scenario label. Default preferences now require approval.
- [ ] Fix `docs/INTEGRATION-STATUS.md` contradictions and old `/api/v1/...` paths. Docs must match the real API.
- [ ] Optional: rename procurement → purchasing in the UI (`useProcurement`, `features/procurement`). The API says purchasing.
- [ ] Remove unused `src/client/provisional/unavailable-service.ts`. Dead code.

## Agent (AI)

Done
- [x] Mastra set up on Gemini (`google/gemini-3.8-flash`). Since #8 the key is required at run time; `TEST_MODE=TRUE` switches the agent, extraction and proposal revision to the deterministic flow and mock model (`server/agents/mode.ts`), so builds, CI and offline tests need no key.
- [x] Tests for the mode gating (`purchasing-features.test.ts`: test mode vs Gemini key).
- [x] Agent turn endpoint `POST /api/agent/run` (buyers) with tools: search, product details, inquiry, create/revise/get/verify proposal, place order, recipes/inventory, intelligence. The agent can act end to end.
- [x] The agent acts for the signed-in buyer through the one guarded flow; it can order only what the rules allow or an approver approved, and can't approve.
- [x] Free-text extraction `POST /api/extract` and natural-language proposal changes (Gemini; deterministic parser in test mode). "1,000 L milk by Monday" → structured items.
- [x] One set of rules: the agent's candidate filter and the policy both read the layered preferences.
- [x] Selection steps (search, filter, ranking, split, drift) are written to the audit log. "Readable record of what the agent did and why".
- [x] Search on the real catalog with real allergen data; synthetic products only without a real catalog.

Left
- [ ] Streamed chat events for the UI (status, message, proposal, approval, order). `/agent/run` returns one turn; the frontend's chat expects a stream.
- [ ] Agent identity and scopes (API keys) for external agents, then attribute calls to the agent key, not only "agent for user".
- [ ] Decision-maker for missing data (unknown allergens, CO2) and good-better-best choice with explanations. Deliberately left out of the policy check.
- [ ] Use `language`, `allowSubstitutes` and preferred origin/vendor/brand in the agent's ranking and answers.
- [ ] Allergen-safe substitution under pressure: needs the `MAY_CONTAIN` qualifier imported. School/hospital scenario.
