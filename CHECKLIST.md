# Checklist

What is done and what is left, per part. One line each: what, and why it matters.
Challenge core: lookup, inquiry → order at fixed prices, permissions and human approval. Optional: delivery/sustainability comparison, substitutions, audit trail.

State: one purchasing system after the merges of `dev-agent` (#6, #8) and `feat/integrate-frontend` (#7) and the unification commits. Since #8 the agent needs Gemini unless `TEST_MODE=TRUE`. Prompts, recipes and the agent end in a normal proposal; one rule source (layered preferences); one order model (`proposal` → `approval` → `purchase_order`); organization-wide audit log; default-deny API. `pnpm check` and `pnpm test` pass.

## Before pushing to `main` (deploys)

- [ ] Re-import the catalog after migration 0007 (`pnpm data:import`, locally and on the server), otherwise the new columns are empty: no content per unit (no unit conversion), no labels, no nutrition, no dietary tags.

- [ ] Production `.env` on the server has `GOOGLE_GENERATIVE_AI_API_KEY` (or `TEST_MODE=TRUE` for a demo without Gemini). Since #8, `/api/agent/run`, `/api/extract` and `/api/proposals/from-prompt` fail without one of them.
- [ ] Local `.env`: same choice. The live check script's agent step expects the deterministic flow, so run it with `TEST_MODE=TRUE`.
- [ ] Tell the frontend dev about the contract changes: `agent` (`proposalId`, `activeProposal`), recipe response (`proposal`, `selection`, `message`), `intelligence` recurring check (`proposalId`), `catalog` nutrition nullable, removed `orders.ts`/`guardrails.ts` contracts, new `selection.ts`/`allergens.ts`/`labels.ts`; products: new summary/detail fields, search filters, `/products/rank`, `/products/{id}/substitutes`; `/api/catalog/*` removed; proposal lines `substituteFor`. Nothing in the UI uses them yet, but the next integration will.

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
- [x] Quantities in real units: `server/valio/units.ts` converts L/dl/ml/kg/g/cases/pieces through the imported content per base unit (1000 L → 200 cases of 5 L); unconvertible amounts keep a proposal warning.
- [x] One product search: `GET /api/products` with allergen (contains/may contain), dietary, origin, CO2, reliability, vendor, brand and label filters and sorting; `/api/catalog/products*` removed, substitutes at `POST /api/products/{id}/substitutes`.
- [x] Ranking endpoint `POST /api/products/rank`: best/better/good by price per litre/kg, availability by the date, relevance, reliability, CO2 and preferences, with reasons; the agent's selection uses the same scorer.
- [x] Substitute rule: split, swapped and fallback lines carry `substituteFor`; `allowSubstitutes=false` → REQUIRE_APPROVAL `SUBSTITUTE_NOT_ALLOWED`. Plus `MAY_CONTAIN_EXCLUDED_ALLERGEN` → approval.
- [x] Imported nutrition, labels, claims, content per base unit and the allergen CONTAINS / MAY_CONTAIN qualifier (migration 0007; run `pnpm data:import`).
- [x] Snapshot id on every price/stock answer (`snapshotId`, frozen per proposal line, checked by `/verify`) and Ed25519-signed proposal hashes, public key at `GET /api/trust/public-key`.
- [x] Approval expiry (`EXPIRED` with the quote, audited, 409 `APPROVAL_EXPIRED`) and `GET /api/approvals/pending-count` for a badge (migration 0008).
- [x] Migrations without restart: `pnpm dev` applies pending ones on start, and a running dev server applies new ones on the next request.
- [x] Removed the `server/valio/types.ts` re-export shim.
- [x] Retired tables (`procurement_order`, `procurement_audit_event`, `organization_procurement_settings`) dropped in migration 0010; images older than `9077a91` can't be rolled back to.
- [x] Agent errors: 503 `AGENT_NOT_CONFIGURED` without a Gemini key (and no `TEST_MODE=TRUE`), 502 `MODEL_FAILED` when a model call fails, instead of a plain 500.
- [x] README "LLM (Gemini)", root AGENTS.md and deploy README: the agent needs a Gemini key unless `TEST_MODE=TRUE`.

- [ ] Agent identity: per-agent API keys created/revoked by approvers, scopes, every call attributed. The challenge is about external agents; today only humans with cookies can call the API.
- [ ] Audit trail: insert-only event log (actor, action, reason, time) + `GET /api/audit`. Human-readable record of what was done and why (optional direction, high value).
- [ ] Usernames in proposal/approval/order responses. Approvers should see "alice", not a user id.
- [ ] Default-deny API (uncomment `TODO(default-deny)` in `src/server/api/app.ts`). A forgotten guard must not leak organization data.
- [ ] Quantities in real units: content volume/weight per product + conversion ("1,000 L" → cases). The example request is in litres; the catalog sells cases.
- [ ] Agent-friendly search: filters (exclude allergens, origin, max CO2, min reliability, vendor, brand) and sorting. Agents must narrow down before asking Valio for prices.
- [ ] Comparison/ranking endpoint: good-better-best on price, reliability, CO2, preferred origin/vendor/brand, with reasons. Delivery and sustainability comparison (optional direction).
- [ ] Substitutes per product filtered by allergens and availability, + policy rule "substitute outside preferences needs approval". Exception handling (optional direction).
- [ ] Partial availability: split lines when stock is short. "Response logic" for partial stock.
- [ ] Provenance: snapshot id + `fetchedAt` on every price/stock answer; optionally signed proposal hashes. Trust protocol: verify claims without a manual check.
- [ ] Approval expiry and a pending-count endpoint for a badge. Approvals shouldn't wait forever or go unnoticed.
- [ ] Apply migrations without restarting the dev server (`ensureDatabase` runs once per process). Teammates get 500s after pulling a migration.
- [ ] Remove the `server/valio/types.ts` re-export shim. Legacy indirection.
- [ ] Retired tables (`procurement_order`, `procurement_audit_event`, `organization_procurement_settings`) stay unused; drop them only in a later cleanup once rollbacks to old images are no longer needed. Migrations are additive.
- [ ] Map agent configuration and model errors to a clear response: a missing `GOOGLE_GENERATIVE_AI_API_KEY` throws a plain `Error`, and since #8 a failed model call in extraction or proposal revision is no longer caught, so both become `500 Internal error`. Return e.g. 503 "agent not configured" / 502 "model failed" with a message.
- [ ] README "LLM (Gemini)" still says the agent falls back to a mock model without a key; since #8 it requires the key unless `TEST_MODE=TRUE`. Update README and the root AGENTS.md agent notes.
- [ ] Stretch: MCP-style interface over the endpoints. Makes the API directly agent-readable.

## Frontend

Implemented v3.2 (14 November 2026). Evidence and limitations: `docs/FRONTEND-UX-IMPLEMENTATION-STATUS.md` and `docs/INTEGRATION-STATUS.md`. Checked integration means actual local backend/browser evidence where stated, not production or supplier fulfillment.

Left
- [ ] Switch the purchasing flow to `/api/proposals` (incl. `from-prompt`), `/api/approvals`, `/api/orders` (map EUR excl. VAT, statuses, hash-bound approvals, no intent). Approvals then work across browsers and users.
- [ ] Manual buyer flow: search, pick quantities, policy preview, create proposal/order. Replaces the scripted scenarios.
- [ ] Show the agent's `selection` (ranking reasons per product, conversion note) and `warnings` on a proposal.
- [ ] Use `GET /api/products` filters and `POST /api/products/rank` in a product picker; show content per case, labels, allergens (contains / may contain) and nutrition.
- [ ] Handle `QUOTE_EXPIRED`, `PRICE_CHANGED`, `AVAILABILITY_CHANGED` and show `quoteExpiresAt`. Users must know to create a new proposal.
- [ ] Show the `EXPIRED` proposal/approval status and `APPROVAL_EXPIRED`, an approvals badge from `GET /api/approvals/pending-count`, and the proposal signature / `verify` result (`signatureValid`, snapshot ids). New backend fields since migration 0008.
- [ ] Label VAT: the policy limit is excl. VAT, screens show incl. VAT. Otherwise correct numbers look like a bug.
- [ ] Preferences screen (incl. the new caps, category/product lists, dietary restrictions) and members screen. Backend exists; nobody can change settings without curl.
- [ ] Audit page (`/api/audit`) and per-proposal timeline (`/api/proposals/{id}/audit`) on real data. Shows what happened and why.
- [ ] UI for agent run, recipes, inventory and intelligence. The features are invisible in the UI.
- [ ] Remove connected-mode scenario glue (`real-catalog.ts`, `realScenarioFixture`, hand-made litres table) after the switch. Legacy once real flows are used.
- [ ] Rename or remove the "Within the demo limit" scenario label. Default preferences now require approval.
- [ ] Fix `docs/INTEGRATION-STATUS.md` contradictions and old `/api/v1/...` paths. Docs must match the real API.
- [ ] Optional: rename procurement → purchasing in the UI (`useProcurement`, `features/procurement`). The API says purchasing.
- [ ] Remove unused `src/client/provisional/unavailable-service.ts`. Dead code.
- [x] One shared shell, tokens, Inter, Light/Dark/System, role-aware navigation, account/notifications, desktop/tablet/mobile layouts. All 29 Stitch state families mapped.
- [x] Real sign-in and identity/organization/roles from `/api/me`; Buyer + Approver supported. No connected-mode role switch.
- [x] Canonical purchasing uses `/api/proposals`, `/api/approvals`, `/api/proposals/{id}/order` and GET `/api/orders`, numeric EUR excl. VAT, server hashes and stable idempotency. Real two-browser approval/order/replay test passed.
- [x] Manual buyer search, sales-unit quantities, actual shortlist offers, policy preview and proposal creation. Tested with connected catalog and backend.
- [x] Continuous conversation, editable composer, nonmodal review, information questions, immutable revision/supersession, rejection recovery and hard safety blocks. Conversation orchestration remains local until streamed API exists.
- [x] Quote expiration and 409 QUOTE_EXPIRED / PRICE_CHANGED / AVAILABILITY_CHANGED recovery; show quote expiry and prepare updated proposal. Injected conflict tests verify no local fallback order.
- [x] Exact net price labels. No universal VAT assumption; gross/tax unavailable rather than invented.
- [x] Preferences layer/lock editor and separate effective role settings. Connected load/save passed; invalid limits and lock inheritance tested deterministically.
- [x] Organization colleague creation/role editing UI, both roles, last-approver error handling. Real member creation/role changes and organization read tested locally.
- [x] Recipes library/detail/create/editor/batch planning, stock subtraction, verified unit conversions and substitute review. Existing recipe writes are local drafts with explicit new-version POST.
- [x] Restocking overview/new/edit/pause/delete/manual checks; ready, partial/late, unknown and pending coverage. Plans/runs are browser-local; real inventory/offers and canonical purchase adapter underneath.
- [x] Orders list/detail and read-only payment-unavailable checkout use canonical IDs, no alternate AI order lifecycle.
- [x] Settings registry, scoped browser activity evidence and honest integration status; no fabricated credentials, global audit, scheduler, MCP or payment success.
- [x] Removed connected scenario glue `real-catalog.ts` and hardcoded litre lookup. Replaced active default with human-review-first flow and removed misleading scenario copy from visible routes.
- [x] Updated design system, integration tracker and current handoff; archived old provisional `/api/v1` assumptions. `unavailable-service.ts` retained because legacy imports/tests still use it.
- [x] `pnpm check`, `pnpm test`, connected/fixture `pnpm build`, deterministic browser workflow/themes/responsiveness and connected two-user browser test. Detailed counts in implementation report.
- [ ] Streamed, server-persisted AI conversation and autonomous tool safety (backend endpoint/contracts needed).
- [ ] Durable restock plan CRUD/scheduler/run history and cross-user stock reservation/coverage (backend needed).
- [ ] Real external agent key creation/revocation and MCP (backend needed; unavailable UI implemented).
- [ ] Global append-only audit via `/api/audit` (backend needed; browser-local activity UI implemented).
- [ ] Positive dietary/free-from evidence and server-authoritative physical unit conversions (backend needed; unknowns blocked).
- [ ] Remote recipe update/version semantics, payment and supplier dispatch (backend support needed).
- [ ] Optional removal/renaming of historical `features/procurement` / `client/provisional` regression surface. Not used by active routes; retained without altering backend naming.

## Agent (AI)

Done

- [x] Mastra set up; Gemini when `GOOGLE_GENERATIVE_AI_API_KEY` is set, mock model otherwise. Builds and CI need no key.

Left
- [ ] Streamed chat events for the UI (status, message, proposal, approval, order). `/agent/run` returns one turn; the frontend's chat expects a stream.
- [ ] Decision-maker for missing data (unknown allergens, CO2) and good-better-best choice with explanations. Deliberately left out of the policy check.
- [x] The agent's ranking uses preferred origin/vendor/brand and sustainability labels; `allowSubstitutes` is enforced by the policy.
- [ ] Use `language` in the agent's answers.
- [ ] Allergen-safe substitution under pressure: the data (contains / may contain) is now imported; build the school/hospital scenario on top (strict mode excluding may-contain).

- [ ] Chat endpoint with streamed events (status, message, intent, proposal, approval, order). The frontend's chat UI already expects this event shape.
- [ ] Intent extraction: free text → products, quantity + unit, needed-by date, constraints. "1,000 L lactose-free milk by Monday" must become structured lines.
- [ ] Search tool on the real catalog service (`services/catalog.ts`); today it returns fixed fake data. Agent answers must be real.
- [ ] Decision-maker: handle missing data (unknown allergens, CO2), choose good-better-best, explain the choice. Deliberately left out of the policy check.
- [ ] Act through the same API: policy preview → proposal → approval or order, within the agent's key and scopes. Agents must not bypass the guardrails.
- [ ] Use preferences: `autonomy`, `allowSubstitutes`, `language`, preferred origin/vendor/brand for ranking. The settings already exist for this.
- [ ] Write its reasoning into the audit trail. "Readable record of what the agent did and why".
- [ ] Substitution with recipe logic (allergen-safe under pressure). Example scenarios from the challenge.
- [ ] Stretch: proactive selling agent, need → recipe → order. Extra challenge scenarios.
