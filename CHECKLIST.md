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

Done
- [x] Real sign-in, user, organization and roles from `GET /api/me`. Screens per role.
- [x] Demo scenarios use real catalog products, prices and availability. No synthetic prices in connected mode.
- [x] Demo scenarios use the real policy decision. Limits come from the organization's preferences.

Left
- [ ] Switch the purchasing flow to `/api/proposals`, `/api/approvals`, `/api/orders` (map types: EUR excl. VAT numbers, `ORDERED`, hash-bound approvals, no intent). Approvals then work across browsers and users.
- [ ] Manual buyer flow: search products, pick quantities, policy preview, create proposal. Replaces the scripted scenarios until the agent exists.
- [ ] Handle the new 409 codes (`QUOTE_EXPIRED`, `PRICE_CHANGED`, `AVAILABILITY_CHANGED`) and show `quoteExpiresAt`. Users must know to create a new proposal.
- [ ] Label VAT: the policy limit is excl. VAT, screens show incl. VAT. Otherwise correct numbers look like a bug.
- [ ] Preferences screen (approvers edit layers and locks). The backend exists; nobody can change settings without curl.
- [ ] Members screen (create colleagues, change roles). Same: backend exists, no UI.
- [ ] Agent keys screen (after the backend). Approvers create and revoke agent access.
- [ ] Audit page on `GET /api/audit` (after the backend). Shows what happened and why.
- [ ] Remove connected-mode scenario glue (`real-catalog.ts`, `realScenarioFixture`, hand-made litres table) after the switch. Legacy once real proposals are used.
- [ ] Rename or remove the "Within the demo limit" scenario label. Default preferences now require approval, so it's misleading.
- [ ] Fix `docs/INTEGRATION-STATUS.md` contradictions and `/api/v1/...` paths in planning docs. Real paths are `/api/proposals`, `/api/approvals`, `/api/orders`.
- [ ] Optional: align naming procurement → purchasing (`useProcurement`, `features/procurement`). Backend and OpenAPI say purchasing.
- [ ] Remove unused `src/client/provisional/unavailable-service.ts`. Dead code.

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
