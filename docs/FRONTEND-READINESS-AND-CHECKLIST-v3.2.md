> Historical pre-implementation inspection of the supplied archive. The implementation on this branch now supersedes its frontend findings and unchecked frontend list; see [current implementation evidence](FRONTEND-UX-IMPLEMENTATION-STATUS.md) and [integration tracker](INTEGRATION-STATUS.md). Backend-owned findings remain separate.

# Aimo TrustBridge — Frontend Readiness & Checklist Reconciliation v3.2

**Review basis:** `stitch_aimo_trustbridge_product_ux_v3.2_simplified (1).zip`, `junction-2026_2.zip`, and `UX-CHANGELOG — Aimo TrustBridge v3.2 (Simplified)` supplied on 14 Nov 2026.

**Method:** inspected the actual ZIP entries, source files, contracts, router registrations, `CHECKLIST.md`, changelog, and screen images. This is a **static inspection** of the supplied repository snapshot, **not** a claim that the app was run against a live database or Valio API. The current branch may have moved since that archive was made.

## Executive assessment

- **Design implementation-ready: YES, with normalization.** Stitch exports **29 distinct frames/states**, `code.html` and `screen.png` for each, and one shared `DESIGN.md`. A/B/C/D stages cover Assistant (A1–A3), conversation/approvals/checkout (B1–B10), restock/recipes (C1–C7), and orders/admin/responsive references (D1–D9). Use visual references, not exported HTML as production code.
- **Frontend shell exists:** Task 1 AppShell, light/dark/system, navigation, account menu, responsive patterns, Buyer/Approval/Order UI and mock workflow exist.
- **Some backend APIs are already real:** auth + `/api/me`, products, offers, policy, proposals, approvals, purchasing orders, preferences, members, inventory, recipes, substitutions/intelligence, non-streaming `/api/agent/run`.
- **Current frontend is not fully integrated:** `src/client/api-client.ts` still exposes `procurement: createMockProcurementService(...)` **even in connected mode**. Connected mode only adds real identity, product/offer and policy data to scripted local purchasing. Cross-browser approval is not functional via current UI.
- **Completion requires both workstreams:** frontend can implement all 29 frames plus mock-only missing functions; it **cannot make backend-only checklist items real** without work by the backend owner.

## Critical findings (prioritized)

| Priority | Finding supported by archive | Consequence / required action |
|---|---|---|
| **P0** | `CHECKLIST.md` specifies a canonical purchasing workflow. Real backend routes include `/api/proposals`, `/api/approvals/{id}/decision`, `/api/proposals/{id}/order`. Frontend still uses provisional `src/client/provisional` and browser-local orders. | Implement a typed **real purchasing adapter** against `src/shared/contracts/purchasing.ts`; maintain a separate mock adapter. In connected mode, server purchasing is the source of truth, never the local simulator. |
| **P0** | `src/shared/contracts/purchasing.ts`: EUR `number` amounts **excluding VAT**, statuses `READY/PENDING_APPROVAL/APPROVED/REJECTED/BLOCKED/ORDERED/CANCELLED`, approval is hash-bound. Provisional DTOs use string cents gross and `COMMITTED_SIMULATED`. | Map at the client boundary; do not edit shared contracts. Display exact price semantics. Respect `proposal.hash`, quote expiry, 409 conflicts and server idempotency. |
| **P0** | `src/client/mocks/scenarios.ts` includes `happy-path-auto` labeled “Within the demo limit”, with `ALLOW`. New product decision: **human approval required by default**. | Replace default flow; keep an **explicit admin-enabled autonomy** showcase if policy genuinely allows it. Do not present backend `ALLOW` as authorization to override org's approval-first decision. |
| **P0** | Real backend has **two order flows**: immutable proposal → approval → order in `purchasing.ts`; and an alternate AI order lifecycle in `orders.ts` (`POST /api/orders`, `/api/orders/from-recipe`, `/orders/{orderId}/approval`, checkout). | Treat them as **different models**. Use canonical purchasing proposal flow for review/commit. Do not mix IDs/statuses or assume the alternate agent endpoint is interchangeable. Request backend reconciliation for eventual consolidation. |
| **P0** | Real backend only exposes non-streaming `POST /api/agent/run` (in `agent.docs.ts`), not a structured chat SSE route. Existing assistant UI is scripted. | Prefer backend response for **safe, read-only** agent activities when possible; mock live stage events honestly until real streaming is exposed. Do not let conversational tool calls bypass purchasing approval path. |
| **P0** | `.gitignore` contains `design/**`. New Stitch files are not guaranteed to be tracked. | Add a narrow exception for `design/stitch-v3.2/**` or intentionally force-add; verify `git ls-files design/stitch-v3.2` before committing. |
| **P0 security** | `src/server/api/app.ts` still contains `TODO(default-deny)`; some routes use `resolveOptionalUser`. `CHECKLIST.md` marks default-deny and per-agent API keys as not done. | No frontend workaround can enforce server authorization. Flag to backend owner; avoid claiming the platform is production-secure. Scope exposed connected features cautiously. |
| **P1** | `GET /api/recipes`, `GET /api/recipes/{recipeId}`, `POST /api/recipes` exist; no recipe update/delete route. Inventory read/create/replace/adjust exists. | Connect reads and supported writes; use local draft UI for unsupported recipe edits, never claim remote save. |
| **P1** | `GET /api/intelligence/stockout-alerts` and related intelligent checks exist, but no `/api/restock-plans` CRUD, scheduler, durable restock runs. | Restock plan CRUD and scheduler must remain clearly local/temporary. The “Run check” action may call available read-only APIs, but scheduled execution is **not active** without backend scheduler. |
| **P1** | Global audit route `/api/audit` not registered, although order-level `/api/orders/{id}/audit` and verification endpoints exist for alternate order model. | Connect per-order evidence only when matching object type; global Activity & Audit gets local story events/mock until backend implements it. Never claim a cryptographically immutable ledger. |
| **P1** | `src/shared/contracts/me.ts` only has roles `buyer`, `approver`, not `admin`; one user can hold both roles. | UI can label authorized approver settings as Administration, but cannot invent an API `ADMIN` role; self-approval only when server authorizes it. |
| **P1** | Current `src/client/real-catalog.ts` uses hard-coded litre-per-sales-unit maps. `CHECKLIST.md` also marks real unit conversion missing. | Do not treat these maps as universal; use verified, provenance-tagged physical conversions. Block unsupported conversions from automatic ordering. |
| **P1** | Stitch D8 is labeled “Mobile 390px”, but `screen.png` is **1600×1280** with a mobile mockup inside; D9 is a genuine 390px image. | Implement responsive layouts from rules and test **real 390px viewport**, not screenshot dimensions. |
| **P1** | `docs/INTEGRATION-STATUS.md` still calls existing purchasing endpoints unintegrated; provisional handoff mentions `/api/v1/` assumptions. | Update docs to real routes with evidence after integration; do not carry `/api/v1` assumptions forward. |
| **P1 docs** | The supplied repository ZIP does **not** contain `docs/VALIO-CLIENT-TASKS.md` or `docs/VALIO-SERVER-TASKS.md`, despite earlier discussion. | Do not rely on them being present in Codex workspace. Use the attached v3.2 task/changelog and actual shared contracts; restore prior specs separately if required. |
| **P1 design conflict** | Exported Stitch `DESIGN.md` still mentions a persistent demo strip and `Demo checkout`, while the newer **v3.2 changelog** specifies a single `Development` header tag and no visible simulation terminology. The repository `docs/DESIGN-SYSTEM.md` is an older v1.0 version. | Treat v3.2 UX/copy decisions as newer; update the canonical design-system documentation so it no longer conflicts with the final UI. |
| **P1 privacy** | Project ZIP contains a `.env` file. | Do not copy it to deliverables, Git, design exports, screenshots, test output or prompts. Verify ignored and consider rotating any keys if the archive was shared beyond trusted people. |

## Stitch visual audit

**What is already good**

- Light Nordic green palette, ample whitespace, intentionally compact product cards, one main CTA per page, assistant composer, a single shell/header, progressive disclosure, and clear approval-first wording.
- Realistic screen families for proposal revision (`B3`), factual follow-up without invalidation (`B4`), reject and recovery (`B5`), hard-block (`B6`), review sidebar (`B2`), and restocking/recipes (`C1`–`C7`).
- Dedicated dark (`D7`) and mobile (`D8`, `D9`) examples to anchor responsive/theming work.

**Fix in implementation**

- All 29 are frames/states, **not 29 independent URLs**. Multiple A/B frames use the same `/buyer/conversations/[id]` route.
- Exported HTML repeats navigation, CSS and layout; implement a **single** `AppShell`, `Header`, `Sidebar`, `AccountMenu`, `ThemeToggle`, and `Development` label.
- Treat D7 only as the dark token/reference, not a separate page. The same DOM, typography and spacing must work across light/dark.
- Simplify static tables/drawers at phone widths. D8 is not proof of actual responsive implementation.
- Keep “Conversation composer always usable” in proposal/review/blocked/rejected paths.
- Avoid rendering unrelated states together (C7 mixes recipe ambiguity with an allergen failure); give separate, context-dependent states.
- “Order recorded” ≠ supplier order committed; “Payment unavailable” ≠ paid. Make source/status discoverable in details/Integration screens without repeating “mock/simulated” in visible UI. A single `Development` indicator is allowed.
- Screenshot-specific names, times, quote amounts, VAT rates, availability and delivery dates are **visual example data**, not API truth. In connected mode derive from real responses.

## Reconciliation with repository CHECKLIST.md

### Backend/static API — entries checked [x] in snapshot

The supplied checklist states products/offers, organizations/roles, preferences, policy evaluation, proposals/approvals/orders, 24 h quotes/revalidation and tests are done. Matching routes/contracts exist in source. **Runtime connectivity to the DB or live Valio has not been independently tested in this review.**

### Backend/static API — unfinished [ ] items, owned by backend

| Checklist subject | What frontend can do now | What requires backend owner |
|---|---|---|
| Agent identity/scoped API keys | Design/register UI and pending state | Real create/revoke/token enforcement and attribution API |
| Global append-only audit + `/api/audit` | Readable UI, frontend timeline; per-order evidence if available | Global audit persistence, role filtering, audit endpoint |
| Usernames in procurement responses | Resolve known users from `/api/me`/members where permissible | Return actor display names in read DTOs |
| Default-deny API | Display permissions correctly | Enable middleware, review optional-user routes, test tenant isolation |
| Physical units/conversions | Render evidence; flag UNKNOWN; no hardcoded generic L/kg | Verified server conversion and order validation |
| Advanced search/ranking/substitutes | Use existing `/api/catalog/substitutions` and `/api/products` where data really exists | Finish missing filters, preference-safe ranking and stock-split correctness |
| Partial availability | Show shortages and split proposals if actually returned | Backend deterministic split/order consistency |
| Provenance/expiry | Show `quoteExpiresAt`, source, checked time if provided | Comprehensive snapshots/cryptographic proofs as applicable |
| Approval expiry/pending count | Derive count from GET `/api/approvals` for approvers | Expiry mechanism and dedicated count route |
| Migrations hot apply / cleanup | Report problems | Infrastructure/schema maintenance |
| Merge branch to main | Prepare frontend commit/PR | Git merge/deploy by team |
| Standing orders / MCP | UI mock/documentation only | Durable scheduler/external agent protocol |

Note: `CHECKLIST.md` calls substitution/ranking unfinished, but `POST /api/catalog/substitutions` exists. Treat **route existence** as distinct from **feature-level completeness**; validate responses before declaring a checklist item done.

### Frontend — checked [x] in snapshot

- Connected sign-in, `GET /api/me` and role-aware UI.
- Connected scripted scenarios can use real catalog offer data and real `/api/policy/evaluate`.

### Frontend — unfinished [ ] entries (ALL covered by Codex task)

- [ ] Switch canonical purchasing to real `/api/proposals` → `/api/approvals` → `/api/orders` **without mixing order models**.
- [ ] Manual buyer flow: search, pick quantities, preview policy, create proposal, approval and order.
- [ ] Handle `409 QUOTE_EXPIRED`, `PRICE_CHANGED`, `AVAILABILITY_CHANGED`; show `quoteExpiresAt` and remake-proposal actions.
- [ ] Clarify **EUR ex VAT** spending policy vs **gross incl VAT** display; never invent tax rates.
- [ ] Preferences UI editing layers and locks.
- [ ] Members management and dual-role support.
- [ ] Agent credentials UI once backend allows it; until then an explicit unavailable state.
- [ ] Global audit UI now; real `/api/audit` later, with scoped event source.
- [ ] Remove legacy `real-catalog.ts`, `realScenarioFixture` and handwritten litre maps **after** canonical real adapter works; keep any necessary fixture equivalent in mock layer only.
- [ ] Fix “Within the demo limit” label; approval-first default.
- [ ] Update `docs/INTEGRATION-STATUS.md` and stale `/api/v1` references.
- [ ] Optional rename procurement → purchasing, safely and only if worthwhile.
- [ ] Remove `src/client/provisional/unavailable-service.ts` **only after verifying it is unused**.

### Agent [ ] checklist entries

Frontend can present progress, explain policy, support input and safely display suggestions. A true streamed agent endpoint, free-text extraction, catalog-grounded tools, preference-aware decisions, secure scopes, durable audit, safe recipe substitutions and real MCP remain **backend deliverables**. Codex may surface their unavailability, log integration requirements and maintain honest scripted fallback; do **not** mark these done on behalf of backend.

## Definition of implementation-ready

1. The existing 29-screen Stitch zip is committed/accessibly staged in a tracked directory.
2. `DESIGN-SYSTEM.md` + changelog + this audit define the visual precedence over individual code.html variations.
3. Codex uses **existing** shared contracts for real HTTP in connected mode; isolated adapters/fixtures for gaps.
4. Purchasing UI is approval-first by default and preserves real server policy decisions.
5. Every CTA does something meaningful or shows an explicit unavailable explanation.
6. Tests verify connected mode, mock mode, 409/idempotency, refresh/revision, roles, responsive layouts and dark theme.
7. Checklist and integration status are updated with evidence, not optimistic checkmarks.
