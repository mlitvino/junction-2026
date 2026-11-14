# Checklist

What is done and what is left, per part. One line each: what, and why it matters.
Challenge core: lookup, inquiry → order at fixed prices, permissions and human approval. Optional: delivery/sustainability comparison, substitutions, audit trail.

## Static API (backend, no AI)

Done

- [x] Products and offers: `GET /api/products`, `/api/products/{id}`, `/offer`, `POST /api/offers`. Core lookup for agents and UI.
- [x] Organizations, roles (buyer, approver) and members. Who may do what.
- [x] Layered preferences (base → buyer/approver, locks). The rules the policy applies.
- [x] Policy check `POST /api/policy/evaluate`, incl. availability (blocked, late, short stock). Core guardrails model.
- [x] Proposals, approvals, orders with hash binding and idempotent orders. Core inquiry → commitment flow.
- [x] Fixed prices: 24 h quote expiry and order-time price/availability re-check. "Based on fixed prices, not negotiated quotes".
- [x] Unit tests in CI (`pnpm test`). Rules can't silently break.

Left

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
- [ ] Merge `feat/integrate-frontend` into `main`. Only `main` deploys.
- [ ] Remove the `server/valio/types.ts` re-export shim. Legacy indirection.
- [ ] Stretch: standing orders with drift detection. Flag cost/quantity creep before auto-renewal.
- [ ] Stretch: MCP-style interface over the existing endpoints. Makes the same API directly agent-readable.

## Frontend

Implemented v3.2 (14 November 2026). Evidence and limitations: `docs/FRONTEND-UX-IMPLEMENTATION-STATUS.md` and `docs/INTEGRATION-STATUS.md`. Checked integration means actual local backend/browser evidence where stated, not production or supplier fulfillment.

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

- [ ] Chat endpoint with streamed events (status, message, intent, proposal, approval, order). The frontend's chat UI already expects this event shape.
- [ ] Intent extraction: free text → products, quantity + unit, needed-by date, constraints. "1,000 L lactose-free milk by Monday" must become structured lines.
- [ ] Search tool on the real catalog service (`services/catalog.ts`); today it returns fixed fake data. Agent answers must be real.
- [ ] Decision-maker: handle missing data (unknown allergens, CO2), choose good-better-best, explain the choice. Deliberately left out of the policy check.
- [ ] Act through the same API: policy preview → proposal → approval or order, within the agent's key and scopes. Agents must not bypass the guardrails.
- [ ] Use preferences: `autonomy`, `allowSubstitutes`, `language`, preferred origin/vendor/brand for ranking. The settings already exist for this.
- [ ] Write its reasoning into the audit trail. "Readable record of what the agent did and why".
- [ ] Substitution with recipe logic (allergen-safe under pressure). Example scenarios from the challenge.
- [ ] Stretch: proactive selling agent, need → recipe → order. Extra challenge scenarios.
