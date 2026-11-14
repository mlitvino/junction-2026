# Aimo TrustBridge — CLIENT implementation tasks (Codex)

**Version:** 1.0 · 13 November 2026  
**Project:** Junction 2026 — Valio Aimo, *Trusted Trade Agents*  
**Owner:** Frontend developer using **Codex**  
**Partner:** Backend developer using **Claude Code**  
**Status:** implementation-ready team contract; proposed application endpoints below are **ours**, not Valio's.

> **Goal:** Build a polished, honest, responsive UI for a real end-to-end procurement journey: natural-language purchase request → parsed requirements → catalog search → Valio price/availability → product comparison → policy decision → automatic *local simulated order* OR approval → audit. A real, independently authorized external agent must be demonstrable through the same backend. Never represent a simulated order as submitted to Valio.

## 1. Non-negotiable stack, ownership, and collaboration

- **One Next.js project**, App Router, `src/`, TypeScript `strict`; **Tailwind CSS + shadcn/ui**; **pnpm**. No Pages Router, no Server Actions, no parallel React/Vite app.
- Frontend owns `src/app/(dashboard)/**`, `src/components/**`, `src/features/**`, `src/client/**`, client-side tests, UX copy, responsive states, accessibility, mock fixtures and app-specific UI documentation. Backend owns `src/app/api/**`, `src/server/**`, database, Mastra, MCP, deployment/infra and integrations. Coordinate ownership of `src/app/layout.tsx`, `src/app/globals.css` and package configuration before first edits.
- **`src/shared/contracts/**` is jointly controlled.** First agree and freeze v1 Zod schemas and HTTP contracts with the backend owner. Both AI coding assistants must obey one root `AGENTS.md`; root `CLAUDE.md` should reference `@AGENTS.md` so Claude Code receives the same shared rules. Tool-specific safeguards stay in `.claude/` and do not replace runtime authorization.
- Frontend must import only browser-safe packages, `src/shared/contracts`, and `src/client/api-client.ts`. It must **never** import `src/server/**`, `server-only`, Mastra instances, Postgres clients or vendor secrets. Enforce via ESLint `no-restricted-imports` and `pnpm check`.
- API calls must go through the typed `src/client/api-client.ts` abstraction, including SSE. `NEXT_PUBLIC_USE_MOCKS=true` swaps **only the transport adapter**; components use identical Zod DTOs and states in both modes. No hidden, unrelated component-level `fetch` calls.
- `NEXT_PUBLIC_*` must never include secrets or privileged tokens. Web UI uses first-party HttpOnly session cookies; no Valio `X-API-Key`, external-agent bearer credentials, or LLM secrets in browser/localStorage/URL.
- Work in your own branch, merge frequently, do not overwrite backend code, and communicate any contract breaking change *before* coding it.

## 2. What this app is, and what it is not

Product surfaces:
1. **Buyer Workspace** — buyers request goods, see the agent's *actual* progress, inspect requirements and compare evidence-backed candidate products, edit or re-run an intent, and monitor the resulting purchase.
2. **Approval Center** — independently authorized human approvers review immutable proposals, see exactly what requires approval, and approve/reject with a visible decision trail.
3. **Trust Control Center** — organization admins see agent identities, scopes and delegated purchasing policies, and can create/revoke credentials.
4. **Orders & Audit** — persisted list and details of *locally simulated* orders plus understandable, filterable audit events.
5. **Integration Portal** — clearly documents REST/OpenAPI and MCP endpoint, supports an external-agent demonstration, and displays connection/health status. This is not a second marketplace.

**UI must never:** invent a price, claim stock is confirmed for `Terminal`, represent a missing allergen as `FREE_FROM`, claim success before the server responds, or call our local simulator a live Valio order. Show source, fetch time, and uncertainty wherever decision-critical.

### Scope priorities, aligned to judging

| Priority | Deliverable | Why |
|---|---|---|
| P0 | Buyer chat, parsed intent, results, proposal, auto-commit state | Working end-to-end (30%); buyer fit (20%) |
| P0 | Approval queue/detail, approve/reject, immutable snapshot and reasons | Autonomy and controls (20%) |
| P0 | Agent permissions summary, order status, audit timeline | Verify trust boundary during live demo |
| P0 | Shared client, complete mock adapter, loading/error/empty states | Enables parallel work and reliable demo |
| P1 | Editable advanced policy, agent credential creation/revocation, comparison controls | Openness and operational depth |
| P1 | Partial availability, substitutes, late deliveries, unknown Terminal stock, allergen evidence | Exception handling (15%) |
| P1 | Readable agent integration portal + MCP demo instructions | Open standards/production story (15%) |
| P2 | Carbon and delivery-reliability comparison polish, saved preferences, extras | Value only after P0 works |

## 3. Navigation, routes and role-aware access

All page paths below are **Next.js web pages** (distinct from `/api/**`). Guard every page using backend-returned identity; hiding UI elements is not authorization.

| Page | Suggested route | Role | P |
|---|---|---|---|
| Login | `/login` | anonymous | P0 |
| Buyer Workspace | `/buyer` | buyer, approver/admin with buyer entitlement | P0 |
| Conversation detail | `/buyer/conversations/[id]` | owning tenant/user | P0 |
| Proposal detail | `/proposals/[id]` | authorized buyer/approver | P0 |
| Approval inbox | `/approvals` | approver/admin | P0 |
| Approval detail | `/approvals/[id]` | approver/admin | P0 |
| Orders | `/orders` | buyer/approver/admin | P0 |
| Order detail & evidence | `/orders/[id]` | tenant-authorized | P0 |
| Audit | `/audit` | privileged tenant audit reader | P0 |
| Agent registry | `/admin/agents` | admin | P1 |
| Agent policy editor | `/admin/agents/[id]` | admin | P1 |
| Integrations/docs | `/integrations` | authorized demo user | P1 |
| Error/unauthorized pages | `/403`, `not-found`, `error` | all | P0 |

Layout: left navigation (Buyer, Approvals with count, Orders, Audit, Agents, Integrations); top bar with authenticated role/organization, server mode label (`Simulated ordering`), API connectivity indicator and a conspicuous *Demo environment* notice. Offer a compact mobile navigation without disabling core approval functions.

## 4. Buyer Workspace: precise user journey

**Example input:** `Order 100 litres of lactose-free milk by Monday. Prefer Finnish products; max total €200.` The exact date must be resolved in **Europe/Helsinki** by backend; display it and invite correction. Do not silently infer allergens, packaging or availability.

**Stage A — Compose:** multi-line message, send, clear validation, disabled duplicate-send during pending requests. Provide 2–3 sample queries for judges, but arbitrary text must work. Show chat history via `GET /api/v1/conversations` and `GET .../:conversationId`.

**Stage B — Live agent execution:** use `POST /api/v1/agent/chat` via `fetch` and parse **SSE** events (the agreed event contract is in the shared appendix). Progress stages are only shown when *received*: `understanding`, `catalog_search`, `offer_check`, `comparison`, `policy_check`, `approval`, `commit`. Show last-known stage and error/retry options; never animate fictitious steps as completed. Stream assistant text incrementally and keep product IDs/proposal IDs from event payloads; support `AbortController` for disconnect without claiming it cancels downstream committed actions.

**Stage C — Inspect requirements:** a collapsible/editable `IntentInspector` shows for each line: normalized query, amount and physical unit, desired date, hard constraints (claims, forbidden allergens), soft preferences (origin, reliability, carbon), budget and whether substitutions/partials are permitted. Distinguish **hard** vs **preferred** visually. If backend returns `needsClarification`, ask for the missing details. Edits call `PATCH /api/v1/purchase-intents/:id`, then re-generate a **new** proposal via `POST /api/v1/proposals`; never mutate an approved snapshot.

**Stage D — Compare products:** show a concise ranked list (2–5 cards) with human name/brand/product ID, sales unit and pack math, normalized physical quantity, quantity overage/shortfall, net/gross total, delivery date, `closingTime`, stock status, reason why it qualifies/does not, and source badges. Secondary attributes: country, verified claims, delivery reliability, carbon, if data exists. Optional absent metrics appear as `Not available`, never `0` or `100%`.

**Stage E — Proposal:** display selected lines + alternative candidates, buyer's hard constraints versus actual evidence, breakdown (net, VAT, gross, deposits if known, unknown charges warning), human-readable policy reasons, and action state. `ALLOW` may auto-commit via backend; `REQUIRE_APPROVAL` shows a pending approval link; `DENY` shows actionable reasons. A visible `Request approval` action calls the server if a proposal is eligible. A manual `Commit simulated order` action, if shown, must call `/commit` and is never a bypass.

**Stage F — Finish:** render the server's `SIMULATED_CONFIRMED` order status with server-issued ID, timestamp, immutable proposal snapshot and audit link. Product-level delivery on a future date is not shown as **delivered**. Show failure or reapproval states distinctly.

**Buyer interaction edge cases:** ambiguous Monday/date, no matching products, price missing, availability late, `salesBlock`, partial quantity, Terminal unknown, unknown physical conversion, missing allergen proof, price changed while approving, stale approval, auth timeout, 429 rate limiting, supplier API 502/503, client disconnect and repeated submit.

## 5. Approval Center: human control, not a decorative button

**Inbox** via `GET /api/v1/approvals?status=PENDING&cursor=&limit=`. Each item: organization, requestor/agent, created/expires time, deadline, total gross, risk tags, proposal ID, required action. Handle refresh and empty states.

**Detail** via `GET /api/v1/approvals/:approvalId`: immutable proposal snapshot (items, quantities, total, date, source timestamps), requested intent, guardrail reasons (e.g. `SPEND_LIMIT_EXCEEDED`, `TERMINAL_STOCK_UNKNOWN`, `SUBSTITUTION_REQUIRES_APPROVAL`), potential exceptions, agent identity and buyer. Show evidence per line and a *clear distinction between approving a simulated purchase and committing an actual supplier order*.

**Actions:** `Approve` and `Reject` call dedicated user-authenticated API endpoints, with mandatory rejection reason, optional approval note, and confirmation modal for approval. Pending state disables double clicks. `409 STALE_APPROVAL` shows `Offer changed — re-evaluate`; `403` shows permission problem. After approval, the server may commit according to policy; otherwise show `APPROVED` plus explicit `Awaiting commit` state. Never fake an order ID.

**Separation of duties:** an external agent must not be able to approve its own request; no admin/client UI technique may bypass server enforcement. Use an actual approver login/session in demo, not a frontend-only role dropdown.

## 6. Security, agent administration, and integration UI

`/admin/agents` lists agent `displayName`, `agentId`, active/revoked status, scopes, last use and policy version; add agent, enable/disable, revoke. `/admin/agents/[id]` loads `GET /api/v1/admin/agents/:agentId` plus the policy and edits a JSON-backed, validated policy: max gross order in EUR minor units, daily spending cap, categories allow/deny, forbidden allergens, auto-commit on/off, substitution rules, require-approval defaults, validity dates.

When issuing a scoped token, **show it only once** in a modal and warn that it cannot be retrieved later. Do not store the token in localStorage, URL, or console. Avoid copying token into issue screenshots. `POST .../credentials` returns a one-time secret: render only in the direct response and do not place it in persistent React global state. Prefer server-delivered one-time preview, and clear after modal closes. Bearer credentials are for agent clients, not buyer UI.

`/audit`: buyer sees only audit for own resources; approver/admin sees tenant-authorized events. Query/filter by trace ID, actor, action, result, resource ID and time; expand events to see reason codes, policy version, evidence refs and redacted metadata. Show human-readable explanations, not just raw JSON. Events should match identifiers returned by the API.

`/integrations`: explain architecture, list available MCP tools from documentation, display `GET /api/v1/integrations/status` and `GET /api/v1/meta`; link to `GET /api/openapi.json`, show `/api/mcp` path, example **non-secret** request, and demonstrate the external client from a documented backend script. Do not put test credentials in static HTML.

## 7. UI component inventory and files

Suggested React components (can simplify, but keep responsibilities):

```text
src/
  app/(dashboard)/buyer/page.tsx
  app/(dashboard)/buyer/conversations/[id]/page.tsx
  app/(dashboard)/proposals/[id]/page.tsx
  app/(dashboard)/approvals/page.tsx
  app/(dashboard)/approvals/[id]/page.tsx
  app/(dashboard)/orders/page.tsx
  app/(dashboard)/orders/[id]/page.tsx
  app/(dashboard)/audit/page.tsx
  app/(dashboard)/admin/agents/page.tsx
  app/(dashboard)/admin/agents/[id]/page.tsx
  app/(dashboard)/integrations/page.tsx
  app/login/page.tsx
  components/ui/**                  # shadcn components
  components/layout/**              # navigation, header, status banner
  features/chat/**                  # ChatPanel, AgentProgress, ConversationHistory
  features/intents/**               # IntentInspector, ConstraintEditor
  features/catalog/**               # ProductCard, ProductEvidence, QuantityBreakdown
  features/proposals/**             # ProposalCard, ComparisonTable, PolicyDecision
  features/approvals/**             # ApprovalInbox, ApprovalDetail, ApprovalActions
  features/orders/**                # OrderList, OrderDetails, SimulatedBanner
  features/security/**              # AgentTable, PolicyEditor, CredentialModal
  features/audit/**                 # AuditTimeline, AuditFilter, EvidenceDrawer
  features/integrations/**          # ProtocolCard, ConnectionHealth
  client/api-client.ts              # only API boundary for frontend
  client/sse-client.ts              # parsing of streaming event contract
  client/mock-api-client.ts         # identical typed DTO interface
  client/mock-fixtures/**           # deterministic named demo scenarios
  client/query-keys.ts             # if using data-query caching
```

Use shadcn primitives for forms, tables, cards, tabs, dialogs, badges, toasts. Make purchase actions distinct from navigation. Avoid giant JSON dumps: display business-level meaning with expandable evidence. Use status `SIMULATED` clearly and consistently.

## 8. API client design, request flow, and error handling

Interface `ApiClient` implemented by `HttpApiClient` and `MockApiClient`. Each method maps exactly to route contract in Appendix A. All HTTP handlers validate Zod responses when useful and translate errors to a single typed `ApiError { code, message, status, traceId, details? }`. If the response violates contract, display a non-success state and log a sanitized diagnostic. Use `credentials: 'include'` for same-origin web sessions. Browser does not attach external-agent bearer tokens.

- Query keys include `tenantId`, resources/filters and IDs; never bleed cached data across login/session change. Clearing session clears cached sensitive UI data.
- Pagination: cursor + limit, using server-returned `nextCursor`; do not fabricate page counts.
- On `401` redirect to login but preserve a safe relative return URL. On `403` show unauthorized; `409` show stale/duplicate/conflict; `422` show field-level validation; `429` show retry delay; `502/503` show vendor unavailable and retain editable draft.
- Use `Idempotency-Key` UUID generated once per user-initiated proposal commit and reused on retry; a new deliberate order gets a new key. Prevent double clicks in UI; server is ultimate authority.
- For SSE use a POST fetch stream and explicit parser (not native `EventSource` with GET). Parse `event:` and `data:` boundaries; don't treat a partial chunk as a complete event. Implement reconnection as a new **query**, never automatically retry side-effecting commits.
- Never assume success from a `200` if payload says `error` or policy `DENY`; render actual domain status.
- Error, loading, empty and stale states are required for *every* API-backed view.

## 9. Mock-first frontend contract and demo fixtures

Use the **same DTOs** in mocks and live implementation; Zod-parse them in tests. Seed demo-specific scenarios, clearly labeled in development mode:

| Fixture | Expected UI |
|---|---|
| `happy-path-auto` | User request → real matching proposal (fixture data) → ALLOW → `SIMULATED_CONFIRMED` |
| `human-approval-budget` | Proposal over agent limit → PENDING → approver accepts → simulated order |
| `supplier-stock-shortage` | Requested quantity unavailable → partial or qualified substitution; trade-off shown |
| `terminal-unknown` | Terminal supply uncertainty, no false stock confirmation |
| `allergen-blocked` | Non-compliant / UNKNOWN mandatory allergen rejected or sent to safe manual review, never marked safe |
| `price-changed` | After approval revalidation fails; reapproval required |
| `auth-forbidden` | External agent privileges insufficient; blocked with audit trace |
| `vendor-timeout` | Error state and retry without fake purchase |

Mocks must emulate **contract and states**, not hard-coded happy-path content independent of input; `MockApiClient` can map representative prompts to fixtures, while unsupported queries show a transparent mock limitation. In production/demo live mode, all dynamic prices come from the backend's Valio adapter. Include a visible `Demo / Mock` vs `Connected` badge as returned by `/meta` rather than inferring from the browser setting alone.

## 10. Accessibility, responsiveness, and presentation requirements

- Desktop first (judging screen) but functional at mobile widths 375–430px. Screens must work at standard browser zoom and keyboard navigation.
- Accessible labeling on forms, dialog focus trap, `aria-live` for stream progress/approval status, meaningful status text not color alone, keyboard accessible comparison table and audit items.
- Display exact data provenance: `Price: Valio mock API · checked at ...` and `Supply: supplier unknown` as appropriate; consistent Europe/Helsinki human times but backend UTC timestamps.
- Locale: English primary demo UI. Names can be fi/sv/en. Never silently translate identifiers or technical code labels; provide a fallback `Unknown code (XX)`.
- Skeletons during lookups, separate *no results* versus *provider offline*, nonblocking notifications for agent progress, explicit confirmation for destructive admin actions, error boundaries.
- Prioritize coherent UI rhythm and fast navigation over animated visual decoration. Show the trust decision prominently in the proposal and approval detail views.

## 11. Incremental delivery with exact handoff gates

| Step | Frontend deliverable | Required backend agreement | Definition of done |
|---|---|---|---|
| F0 | Next.js dashboard shell + auth screens + nav; typed client interface | Zod schema v1 and page roles | login/logout/me mock and route guards work |
| F1 | Buyer chat + real SSE parser + progress timeline | `/agent/chat` event contract | arbitrary text submitted, valid streamed events displayed |
| F2 | Editable parsed requirements + product/offer cards + comparison | intent/product/offer/proposal DTOs and list semantics | products do not leak unknown values, units and evidence displayed |
| F3 | Approval inbox/detail + approve/reject | approval snapshot and state machine | role check UX, optimistic UI not falsely confirmed |
| F4 | Orders list/detail + audit timeline | order/audit DTOs, `SIMULATED_CONFIRMED` | end-to-end mock run complete with trace IDs |
| F5 | Admin agent list/policy, one-time credentials, integration view | admin/token API, MCP tool list | external agent onboarding demonstrable |
| F6 | Full HTTP integration & demo polish | actual backend deployment with CORS/cookie/CSRF settings | three live scenarios pass on deployed HTTPS URL |

### Frontend acceptance tests (minimum)

- `pnpm check` (lint + typecheck), `pnpm build`, unit tests and Playwright smoke tests pass; no browser/server import violation.
- Zod contracts of mocks and real response fixtures agree; contracts test fails if a DTO changes without updating fixtures.
- Buyer can submit free text, see actual statuses and detailed proposal; editing intent invalidates stale proposal view.
- Approval by a genuine logged-in approver works; normal buyer cannot use approval controls to bypass policy (backend verifies this).
- Browser navigation through proposal → approval → `SIMULATED_CONFIRMED` order → audit follows IDs, not hard-coded assumptions.
- All core pages handle 401, 403, 409, 422, 429, provider 502/503, empty state, loading and missing attributes honestly.
- All numeric money/quantities are formatted from **string decimal / integer minor-unit** contract; avoid floating-point arithmetic in frontend.
- No secrets, API keys or customer data in static assets, localStorage, console logs, screenshots or error messages.

## 12. Frontend/backend coordination protocol

1. Agree on **Appendix A** before implementing the UI; backend supplies real validators and example payloads; frontend creates fixtures from same schemas.
2. Every new backend endpoint comes with Zod request/response, role/scope, error cases, sample response and at least one contract test. Frontend integrates through `api-client.ts` only.
3. Changes to shared contracts require a short explicit approval from both owners and a same-day update in both task files. Do not alter `src/shared/contracts/**` independently.
4. Distinguish *web user session cookie* from *external agent bearer token*. The frontend never asks the user to paste vendor credentials.
5. Add/verify a shared root `AGENTS.md` for **Codex and Claude Code**, plus a short `CLAUDE.md` referencing it; `AGENTS.md` must define ownership, quality gates and no-secret rules. Test that each assistant loads the instructions in its actual environment.
6. Backend keeps `/api/openapi.json` current. No component may assume an endpoint exists until backend owner reports contract-ready.
7. Use environment `NEXT_PUBLIC_USE_MOCKS=true` for component work; turn it off for integration and the real judging demo. Record which scenarios are fixture-driven and which call Valio.
8. Merge small changes frequently; avoid changing shared layout/package/scripts in parallel.

## 13. Open questions / explicit assumptions to display rather than hide

- **No Valio Order API was included**: local order simulation is our design; if organizers supply a real endpoint later, replace the adapter on the server.
- **No authoritative supplied unit/category/allergen codebook**: unknown means unknown, and risky decisions stay blocked or manually reviewed. Backend will maintain a provenance-aware curated map.
- **Terminal availability has unknown actual supplier quantity**: show `SUPPLIER_UNKNOWN` even when API returns 999999.
- **`allowedLotSize=0.01` for many discrete packages**: demonstrate conservative whole-unit policy until Valio clarifies semantics. Never mask round-up/overage.
- **Deposits may be billed separately but deposit pricing isn't described**: show `Unknown additional charges` when relevant; do not present an unbounded total as guaranteed.
- **Mock system ignores customer parameter for price/availability in challenge**: still send server-resolved tenant customer for future tenant-sensitive behavior.

> **Source:** supplied `openapi.json`, product JSON and schema, delivery-reliability and carbon CSV, team stack `.docx`, and stated judging criteria. Everything in `/api/v1/**`, MCP, local approvals and order simulator is a **proposed application contract**, not an undocumented feature of Valio Aimo.


---

# Appendix A — SHARED API, DTO AND INTEGRATION CONTRACT (identical in client/server tasks)

**This appendix is copied verbatim into both task files.** Freeze it before team parallelization. Paths here describe **Aimo TrustBridge's proposed API**, not undocumented Valio routes. All JSON is camelCase, UTF-8. Use Zod schemas in `src/shared/contracts/` as canonical runtime validators. Backend owns implementation; both developers approve incompatible changes.

## A1. Route-by-route contract

**Authentication notation:** `U` = logged-in first-party user with tenant-bound HttpOnly cookie; `B` = first-party buyer; `H` = human approver; `A` = organization admin; `G(scope)` = registered external agent with bearer token and listed scope. `U` access still requires resource owner/tenant check. `ANON` = anonymous. For lists default `limit=20`, max `100`, `cursor` opaque; response is `{items:T[], nextCursor:string|null}`. All IDs are opaque string IDs; `/api/v1/**` routes are Next.js Route Handlers.

| # | Method | Route | Authorization | Request / query → response | Priority |
|---:|---|---|---|---|---|
| 1 | GET | `/api/v1/health` | ANON | none → `{status:'ok', buildVersion}`; no secrets | P0 |
| 2 | GET | `/api/v1/meta` | U or G(`catalog:read`) | none → `{orderMode:'SIMULATED_LOCAL', dataMode, capabilities, buildVersion}` | P0 |
| 3 | POST | `/api/v1/auth/login` | ANON | `{email,password}` → `SessionUser`; sets HttpOnly session cookie | P0 |
| 4 | POST | `/api/v1/auth/logout` | U | `{}` → `{ok:true}`; revokes cookie/session | P0 |
| 5 | GET | `/api/v1/auth/me` | U | none → `SessionUser` | P0 |
| 6 | GET | `/api/v1/catalog/products` | U or G(`catalog:read`) | `q,categoryCode,claim,origin,sort,cursor,limit` → `Page<ProductSummary>` | P0 |
| 7 | GET | `/api/v1/catalog/products/:productId` | U or G(`catalog:read`) | path `productId` → `ProductDetail` incl. provenance/packaging | P0 |
| 8 | POST | `/api/v1/offers/check` | B/H/A or G(`offers:read`) | `OfferCheckRequest` → `OfferCheckResponse` with exact Valio source flags | P0 |
| 9 | GET | `/api/v1/purchase-intents` | B/H/A or G(`intents:read`) | `cursor,limit` → `Page<PurchaseIntent>` tenant/ownership filtered | P0 |
| 10 | POST | `/api/v1/purchase-intents` | B or G(`intents:write`) | `PurchaseIntentCreate` → `PurchaseIntent` (DRAFT/READY) | P0 |
| 11 | GET | `/api/v1/purchase-intents/:intentId` | B/H/A or G(`intents:read`) | path → `PurchaseIntent` | P0 |
| 12 | PATCH | `/api/v1/purchase-intents/:intentId` | owning B or G(`intents:write`) | `{expectedRevision,patch}` → **new revision** `PurchaseIntent`; never edit approved snapshot | P0 |
| 13 | GET | `/api/v1/proposals` | B/H/A or G(`proposals:read`) | `status,cursor,limit` → `Page<PurchaseProposal>` | P0 |
| 14 | POST | `/api/v1/proposals` | B or G(`proposals:write`) | `{intentId,intentRevision,selection?,strategy?}` → `PurchaseProposal` including `policyDecision` | P0 |
| 15 | GET | `/api/v1/proposals/:proposalId` | B/H/A or G(`proposals:read`) | path → `PurchaseProposal` with source snapshot | P0 |
| 16 | POST | `/api/v1/proposals/:proposalId/request-approval` | owning B or G(`proposals:write`) | `{expectedVersion}` → `ApprovalRequest`; idempotent if already pending | P0 |
| 17 | POST | `/api/v1/proposals/:proposalId/commit` | authorized B or G(`orders:commit`) | header `Idempotency-Key`, `{expectedVersion}` → `Order`; may 409/422 and must revalidate | P0 |
| 18 | GET | `/api/v1/approvals` | H/A | `status,cursor,limit` → `Page<ApprovalRequest>` | P0 |
| 19 | GET | `/api/v1/approvals/:approvalId` | H/A | path → `ApprovalRequestDetail` with immutable proposal/evidence | P0 |
| 20 | POST | `/api/v1/approvals/:approvalId/approve` | H/A **human session only** | `{note?,expectedProposalHash}` → `{approval,proposal,order?:Order}`; validates before optional auto-commit | P0 |
| 21 | POST | `/api/v1/approvals/:approvalId/reject` | H/A **human session only** | `{reason,expectedProposalHash}` → `{approval,proposal}` | P0 |
| 22 | GET | `/api/v1/orders` | B/H/A or G(`orders:read`) | `status,cursor,limit` → `Page<Order>` | P0 |
| 23 | GET | `/api/v1/orders/:orderId` | B/H/A or G(`orders:read`) | path → `OrderDetail` with source, snapshot, trace | P0 |
| 24 | GET | `/api/v1/audit` | B (own resources), H/A (tenant), or G(`audit:read`) (scope filtered) | `resourceId,traceId,actorId,action,result,cursor,limit` → `Page<AuditEvent>` | P0 |
| 25 | POST | `/api/v1/agent/chat` | B | `{conversationId?,message,clientRequestId}` → **SSE stream** `AgentEvent`; no direct vendor key in browser | P0 |
| 26 | GET | `/api/v1/conversations` | B | `cursor,limit` → `Page<ConversationSummary>` | P0 |
| 27 | GET | `/api/v1/conversations/:conversationId` | owning B | path → `ConversationDetail` with persisted, sanitized messages/events | P0 |
| 28 | GET | `/api/v1/admin/agents` | A | `cursor,limit` → `Page<AgentSummary>` | P1 |
| 29 | POST | `/api/v1/admin/agents` | A | `{displayName,description?}` → `AgentSummary` (no credentials yet) | P1 |
| 30 | GET | `/api/v1/admin/agents/:agentId` | A | path → `AgentSummary` (direct page refresh) | P1 |
| 31 | PATCH | `/api/v1/admin/agents/:agentId` | A | `{displayName?,active?}` → `AgentSummary`; no privilege escalation from buyer | P1 |
| 32 | POST | `/api/v1/admin/agents/:agentId/credentials` | A | `{scopes:string[],expiresAt}` → `{credentialId,token,expiresAt}` **token only once** | P1 |
| 33 | POST | `/api/v1/admin/agents/:agentId/revoke` | A | `{reason?}` → `{agentId,revoked:true}`; immediately invalidates token | P1 |
| 34 | GET | `/api/v1/admin/agents/:agentId/policy` | A | path → `AgentPolicy` | P0 (read), P1 (editor) |
| 35 | PUT | `/api/v1/admin/agents/:agentId/policy` | A | `{expectedVersion,policy}` → new version `AgentPolicy` | P1 |
| 36 | GET | `/api/v1/integrations/status` | A/H/B | none → `{valio:{status,checkedAt},llm:{status,checkedAt},catalog:{importedCount},orderMode}` | P1 |
| 37 | GET | `/api/openapi.json` | ANON (schemas only) | none → OpenAPI 3.x for app REST; no credentials or internal URLs | P1 |
| 38 | GET/POST | `/api/mcp` | G(MCP tool-specific scope) | **MCP Streamable HTTP protocol**, SDK-specific JSON-RPC; tool list and calls, not ad-hoc REST JSON | P0 |

`/api/v1/health` is a minimal liveness check; `/api/v1/meta` reports **truthful environment capabilities**. `GET/POST /api/mcp` must implement current pinned MCP transport semantics (and any additional verbs required by that SDK/version), not invent a custom JSON format. All writes use CSRF/Origin protection for cookie auth, scoped bearer auth for external agents, and server-generated correlation IDs.

**Supplier routes (different host, internal use only):** `GET /api/ping`, `POST /api/price`, `POST /api/availability`, `GET /api/products/download`, `GET /api/delivery-reliability/download`, `GET /api/carbon-footprint/download`. None of the 38 routes above is an official Valio order endpoint.

## A2. Canonical domain types and naming

Use these Zod-backed types and **the exact enum values** in DB-derived responses. Backend may extend with optional fields **only after coordination**; client mocks must validate against the final runtime schemas.

```ts
// src/shared/contracts/domain.ts (illustrative TypeScript; write real Zod schemas)
type Money = { currency: 'EUR'; amountMinor: string }; // integer decimal string, e.g. "12500" = €125
type Quantity = { value: string; unit: string };        // decimal string + unit

type Verification = 'PASS' | 'FAIL' | 'UNKNOWN';
type PhysicalMeasureStatus = 'VERIFIED' | 'CURATED' | 'INFERRED' | 'UNKNOWN';
type StockCertainty = 'STOCK_VERIFIED' | 'SUPPLIER_UNKNOWN' | 'OUT_OF_STOCK' | 'BLOCKED' | 'NOT_DELIVERABLE';
type PolicyOutcome = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
type IntentStatus = 'DRAFT' | 'READY' | 'SUPERSEDED';
type ProposalStatus =
  | 'DRAFT' | 'READY' | 'PENDING_APPROVAL' | 'APPROVED'
  | 'REJECTED' | 'BLOCKED' | 'EXPIRED' | 'REAPPROVAL_REQUIRED'
  | 'COMMITTED_SIMULATED' | 'FAILED';
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
type OrderStatus = 'SIMULATED_CONFIRMED';
type AgentStatus = 'ACTIVE' | 'DISABLED' | 'REVOKED';

type ApiErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
  traceId: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };

type SessionUser = {
  userId: string; organizationId: string; displayName: string;
  roles: Array<'BUYER' | 'APPROVER' | 'ADMIN'>;
};
type ProductSummary = {
  productId: string; name: string; language: 'en'|'fi'|'sv'|string;
  brand?: string|null; categoryCode?: string|null; countryOfOrigin?: string|null;
  salesUnit: string; baseUnit: string; allowedLotSize: string;
  claims?: Array<{code:string; relation:string; verification:Verification; sourcePath:string}>;
};
type ProductDetail = ProductSummary & {
  packaging: Array<{unitId:string;sizeInBaseUnits:string;gtin?:string|null}>;
  physicalMeasures: Array<{value:string;unit:string;basis:string;status:PhysicalMeasureStatus;source:string}>;
  substitutions: string[];
  deliveryReliability?: string|null; carbonKgCo2ePerKg?: string|null;
  source: 'VALIO_SUPPLIED_STATIC_DATA';
};

type OfferCheckRequest = { requestedDate: string; productIds: string[] }; // max shortlist 30 by our rule
// customer reference from validated request context; never input from untrusted agent

type OfferLine = {
  productId: string; requestedDate: string;
  priceNet?: Money|null; priceGross?: Money|null;
  priceValidFrom?: string|null; priceValidTo?: string|null;
  availableSalesUnits?: string|null; availableDate?: string|null; closingTime?: string|null;
  salesUnit: string; logisticModel?: string|null; stockCertainty: StockCertainty;
  blocked: boolean; errorCodes: string[]; source:'VALIO_MOCK_API'; checkedAt:string;
};
type OfferCheckResponse = {
  requestedDate: string; customerReference: string;
  items: OfferLine[]; checkedAt: string; traceId: string;
};

type PurchaseIntentItem = {
  lineId: string; query: string; quantity: Quantity;
  mandatoryClaims: string[]; forbiddenAllergens: string[];
  allowSubstitutions: boolean; allowPartialDelivery: boolean;
};
type PurchaseIntent = {
  id: string; revision: number; status: IntentStatus; originalText?: string|null;
  requestedDeliveryDate?: string|null; items: PurchaseIntentItem[];
  budgetGross?: Money|null;
  preferences: {preferOrigin?:string|null;priceWeight:number;reliabilityWeight:number;carbonWeight:number};
  needsClarification: string[]; createdAt: string; updatedAt: string;
};
type PurchaseIntentCreate = Omit<PurchaseIntent,'id'|'revision'|'status'|'createdAt'|'updatedAt'>;

type CandidateEvidence = {
  productId: string; match: Verification;
  constraintResults: Array<{code:string;result:Verification;reason:string;source?:string}>;
  physicalMeasureStatus: PhysicalMeasureStatus;
  offer?: OfferLine|null; selectionReason?: string;
};
type ProposalLine = {
  requestedLineId: string; productId: string;
  requestedQuantity: Quantity; selectedSalesQuantity: Quantity;
  estimatedPhysicalQuantity?: Quantity|null;
  unitPriceGross?: Money|null; lineTotalGross?: Money|null;
  evidence: CandidateEvidence;
};
type PolicyDecision = {
  outcome: PolicyOutcome; reasons: Array<{code:string;message:string}>;
  evaluatedAt:string; policyVersion:number;
};
type PurchaseProposal = {
  id: string; intentId: string; intentRevision:number; version:number;
  status: ProposalStatus; proposalHash:string;
  lines: ProposalLine[]; alternatives: CandidateEvidence[];
  totalGross?: Money|null; totalNet?: Money|null;
  unknownCharges: string[]; policyDecision: PolicyDecision;
  approvalId?: string|null; orderId?: string|null;
  createdAt:string; expiresAt?:string|null; traceId:string;
};
type ApprovalRequest = {
  id:string; proposalId:string; proposalHash:string;
  status:ApprovalStatus; requestedAt:string; expiresAt?:string|null;
  reasons:Array<{code:string;message:string}>;
  decidedByUserId?:string|null; decidedAt?:string|null;
};
type ApprovalRequestDetail = ApprovalRequest & {proposal:PurchaseProposal};
type Order = {
  id:string; proposalId:string; status:OrderStatus;
  source:'LOCAL_SIMULATOR'; upstreamOrderId:null;
  committedAt:string; totalGross?:Money|null; traceId:string;
};
type OrderDetail = Order & {proposalSnapshot:PurchaseProposal; auditEventIds:string[]};
type AuditEvent = {
  id:string; timestamp:string; traceId:string; actorType:'USER'|'AGENT'|'SYSTEM';
  actorId:string; action:string; resourceId?:string|null; result:string;
  reasonCode?:string|null; explanation:string; metadata?:Record<string,unknown>;
};
type AgentPolicy = {
  agentId:string; version:number; active:boolean;
  maxOrderGross?:Money|null; maxDailyGross?:Money|null;
  allowedCategoryCodes:string[]; deniedCategoryCodes:string[];
  forbiddenAllergenCodes:string[]; allowSubstitutions:boolean;
  autoCommit:boolean; requireApprovalByDefault:boolean;
  validFrom?:string|null; validTo?:string|null;
};
type AgentSummary = {
  id:string; displayName:string; status:AgentStatus;
  scopes:string[]; lastUsedAt?:string|null; policyVersion:number;
};
type ConversationSummary = {id:string; title:string; updatedAt:string};
type ConversationDetail = ConversationSummary & {
  messages:Array<{id:string;role:'user'|'assistant'|'tool';content:string;createdAt:string}>;
  runs:Array<{runId:string;status:string;intentId?:string;proposalId?:string;orderId?:string}>;
};
```

**Required JSON invariants:** never serialize JS native `bigint`; no binary float for authoritative money math; missing price/claims/physical conversion remain `null` or `UNKNOWN`. All `id` values are server-generated opaque strings. The backend must expose correct `productId` joins and per-result source metadata; frontend does no independent price, tax, stock or unit calculations beyond display formatting.

**API error status:** `400` malformed, `401` anonymous/expired, `403` denied, `404` nonexistent or cross-tenant, `409` conflict/stale approval/version/idempotency, `422` invalid domain conditions, `429` throttle, `502/503` upstream unavailable. Every error returns `ApiErrorBody`, with `X-Trace-Id` and (for rate limits) `Retry-After` where available. All successful REST calls return the typed object directly, not an inconsistent wrapper; collections return `Page<T>`.

## A3. Server-sent agent event protocol

`POST /api/v1/agent/chat` uses `Content-Type: text/event-stream` via POST `fetch()` and a byte-stream parser; do **not** assume browser native GET-only `EventSource`. Each event is formatted as `event: <name>\ndata: <JSON>\n\n`. JSON object:

```ts
type AgentEvent = {
  runId:string; traceId:string; sequence:number; timestamp:string;
  data: Record<string, unknown>;
};
// event names and required data:
// status             {phase: 'understanding'|'catalog_search'|'offer_check'|'comparison'|'policy_check'|'approval'|'commit', message:string}
// message.delta      {text:string}
// intent.ready       {intent:PurchaseIntent}
// proposal.ready     {proposal:PurchaseProposal}
// approval.required  {approval:ApprovalRequest}
// order.committed    {order:Order}
// done               {conversationId:string, intentId?:string, proposalId?:string, orderId?:string}
// error              {error:{code:string,message:string}}
```

Every `runId` has monotonically increasing `sequence`; persist meaningful final messages and resource references. Do not send arbitrary tool internals, credentials, raw supplier response bulk dumps or unsupported `success` indications. On stream failure, the client may open the persisted conversation to reconcile final state; **never automatically replay a payment/order side effect**.

## A4. MCP tool contract and REST equivalence

**MCP is a real supported external protocol, not a bespoke JSON endpoint.** Its tools all use the same application service/auth as the REST calls shown below. The mapping is a target for interoperability tests:

| MCP tool | REST equivalent | Minimum scope | Side effect |
|---|---|---|---|
| `search_products` | GET `/api/v1/catalog/products` | `catalog:read` | none |
| `get_product_details` | GET `/api/v1/catalog/products/:productId` | `catalog:read` | none |
| `check_offers` | POST `/api/v1/offers/check` | `offers:read` | supplier reads only |
| `create_purchase_intent` | POST `/api/v1/purchase-intents` | `intents:write` | intent draft |
| `create_purchase_proposal` | POST `/api/v1/proposals` | `proposals:write` | immutable proposal |
| `request_approval` | POST `/api/v1/proposals/:proposalId/request-approval` | `proposals:write` | approval created |
| `commit_simulated_order` | POST `/api/v1/proposals/:proposalId/commit` | `orders:commit` | simulated order, idempotent |
| `get_order_status` | GET `/api/v1/orders/:orderId` | `orders:read` | none |
| `get_audit_for_order` | GET `/api/v1/audit?resourceId=` | `audit:read` | none |

**Never expose** `approve`, `reject`, `set_policy`, `register_agent` or `issue_credential` as agent-accessible MCP tools. All MCP and REST operations must enforce tenant and scope checks inside application services. The independent demo client proves these boundaries.

## A5. Shared fixtures, test sequence and contract-freeze policy

Required sanitized fixtures: `happy-path-auto`, `human-approval-budget`, `supplier-stock-shortage`, `terminal-unknown`, `allergen-blocked`, `price-changed`, `auth-forbidden`, `vendor-timeout`. Each fixture must include an intent, candidate/evidence, Valio-shaped price/availability read (if applicable), proposal policy result, approval/order result and audit trace; clearly label which calls are fixture overrides rather than supplier responses.

**Agreed demo scripts:**
1. Buyer logs in, sends free-text → `intent.ready` → `proposal.ready` → `ALLOW` → `order.committed`, shows `SIMULATED_CONFIRMED` and trace.
2. Buyer asks beyond delegated spending limit → `REQUIRE_APPROVAL` → separate approver logs in and approves → revalidation → local simulated order; demonstrate rejection path too.
3. A *different* MCP client discovers tools with a scoped token, searches, proposes and tries a prohibited commit → 403/422 with reason and audit event. One exception (partial stock / Terminal / allergen / changed price) also demonstrated.

Contract freeze: neither teammate independently changes shared route names, enums, Zod schemas, SSE event names or error envelopes. Propose changes, update BOTH task documents and `src/shared/contracts`, then run contract tests before merge. Team-wide coding agents must read root `AGENTS.md` (and Claude Code's `CLAUDE.md` bridge). Add a `docs/integration-status.md` tracking **mock-only**, **backend-ready**, **integrated**, **live-tested** for every route and scenario.

