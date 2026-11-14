# CODEX MASTER TASK — Aimo TrustBridge v3.2 Complete Frontend Rebuild & Real Backend Integration

**Priority: implement ALL frontend surfaces and flows in a SINGLE execution of this task, with tests.**

**Context:** Junction 2026, Valio Aimo Trusted Trade Agents. Two developers work in the same Next.js repository: **Codex owns frontend**, Claude Code owns backend. This task intentionally bundles UX redesign, real API integration where possible, and typed mock fallbacks for unfinished backend features. Do not wait for backend developer availability. Do not silently change server/shared contracts.

**User's latest design:** `stitch_aimo_trustbridge_product_ux_v3.2_simplified (1).zip` (29 active design frames). **Current code:** `junction-2026_2.zip`, or its equivalent checked-out branch. **Changelog:** `UX-CHANGELOG — Aimo TrustBridge v3.2 (Simplified)`; use it as a screen/flow index. Refer also to `docs/FRONTEND-READINESS-AND-CHECKLIST-v3.2.md` included in the handoff pack.

## 0. Read and verify before editing — but then implement everything

Read in this order:

1. Root `AGENTS.md` and nested frontend instructions in `src/app/AGENTS.md`, `src/components/AGENTS.md`, `src/features/AGENTS.md`, `src/client/AGENTS.md`.
2. Root `CHECKLIST.md` (**do not assume its checkmarks prove runtime behavior**).
3. `docs/DESIGN-SYSTEM.md`, `docs/FRONTEND-MOCK-STRATEGY.md`, `docs/INTEGRATION-STATUS.md`, `docs/PREFERENCES.md` and `src/client/provisional/README.md`. Note: in the archived repository `docs/VALIO-CLIENT-TASKS.md` / `docs/VALIO-SERVER-TASKS.md` are absent; do not block on them or pretend to have read them.
4. The entire `design/stitch-v3.2/` package: one `DESIGN.md`, every exported `screen.png` and relevant `code.html`. Use the 29-screen manifest in this task.
5. The actual shared Zod schemas: `src/shared/contracts/{purchasing,products,policy,preferences,me,organization,recipes,inventory,catalog,intelligence,agent,orders}.ts`.
6. Actual router definitions under `src/server/api/routes/**/**.docs.ts` and `src/server/api/app.ts`, **read-only**, to determine existing paths and request/response types.
7. Existing frontend components/features and tests; preserve anything correct from Task 1 & Task 2.

Check actual repository working tree and branch before changes. Do **not** reset other developer's work. Use installed Next.js 16 documentation from `node_modules/next/dist/docs/` as instructed by root `AGENTS.md`.

**Important:** The archived ZIP contains a `.env`. Do not print, copy, commit, summarize, package, or expose its contents. Use `.env.example` for names only. Never run scripts that upload secrets. Avoid putting credentials in rendered browser code.

### Source-of-truth precedence

| Concern | Authority |
|---|---|
| Repo organization, permissions, stack | Actual `AGENTS.md` + installed project conventions |
| Existing real HTTP request/response models | `src/shared/contracts/*.ts` + actual Hono router definitions |
| Backend capabilities | Actual code routes/services, then runtime verification; do not infer from Stitch |
| Product flows/UX decisions | This task + v3.2 changelog + product discussion |
| Colors/type/components | Unified tokens from old `docs/DESIGN-SYSTEM.md` + new Stitch v3.2 DESIGN.md, **but newest v3.2 changelog/this task overrides outdated demo banners, copy and navigation** |
| Screen-specific composition | Stitch screenshots; exported HTML is **reference-only** |
| Backend behavior not yet implemented | Frontend-only mock + explicit entry in integration status |

If two sources conflict, **do not invent API behavior to satisfy a mockup**. Use a presentation adapter and mark what remains unintegrated.

## 1. Definition of done

Deliver a cohesive Next.js frontend that:

- Implements the full **29-frame design language**, but maps related frames to **real pages and states**, not 29 duplicated routes/layouts.
- Has one `AppShell` with a single header, sidebar, account menu, notifications, theme toggle, and a **single unobtrusive `Development` label** in the header.
- Has one style, semantic color palette, typography, spacing, variants, and shared components across all pages and both themes; no visually inconsistent repeated UI elements.
- Implements full **continuous Assistant conversation**, proposal revision history, quantity changes, explanations, substitutions, approval inline, approval inbox, order review, checkout availability states, and human-friendly recovery.
- Implements **Restocking**, **Recipes**, **Meal Planning**, Orders, Settings & Administration, Policies, Members, Audit, Integrations, with functional actions in supported modes.
- Uses **actual backend data and actual existing endpoints** in connected mode wherever supported; it does not use local browser purchasing approvals/orders when backend purchasing endpoints are available.
- Uses isolated deterministic mocks for **missing** backend capabilities only; those mocks must be API-boundary-local and must not overwrite, shadow, or contradict real server state.
- Enforces **human approval by default** in the UX and follows server-side permissions. A buyer who is also an approver may approve in the conversation and in To Review using the **same request**, if permitted.
- Never lies about supplier fulfillment, payment, actual scheduled execution, inventory freshness, or verified allergens.
- Passes tests and builds. Leaves `CHECKLIST.md`/`docs/INTEGRATION-STATUS.md` truthfully updated, with unimplemented backend items left unchecked.

## 2. Ownership and allowed changes

**Allowed:**

- `src/app/` except `src/app/api/**`: App Router pages, layouts, globals, auth screens.
- `src/components/**`, `src/features/**`, `src/client/**`: components, features, API adapters, typed mocks, integration tests.
- Frontend documentation such as `docs/INTEGRATION-STATUS.md`, `docs/FRONTEND-UX-IMPLEMENTATION-STATUS.md`; root `CHECKLIST.md` **frontend entries only**, with evidence.
- `design/stitch-v3.2/**` source-of-truth export and its manifest.
- A narrowly scoped `.gitignore` exception **only** to ensure `design/stitch-v3.2/**` is tracked; if code ownership disallows this, state exact recommended command/patch, and still implement locally.

**Forbidden without explicit backend-owner coordination:**

- `src/server/**`, `src/app/api/**`, `src/proxy.ts`, `src/shared/contracts/**`, DB/migrations, Mastra and server services, auth middleware, infrastructure/deploy files, package dependency changes.
- Separate backend API routes to work around missing functionality, silent changes to real Zod DTOs, bypassing server policy/auth/price checks.

No new dependency is required by default. Prefer existing React/Next/Tailwind/shadcn primitives. If an essential package is absent, isolate the need and report it; use a safe native implementation if practical.

## 3. Fix design artifact availability first

`junction-2026_2.zip` contains `.gitignore` with `design/**`; this hides Stitch from Git. The bundled design export must be available locally under:

```
design/stitch-v3.2/
  DESIGN.md
  SCREEN-MANIFEST.md
  screens/
    A1/  code.html  screen.png
    ...
    D9/  code.html  screen.png
```

If raw export is already under another accessible path, do not duplicate unnecessarily; choose one canonical design directory and update the references. Verify `git ls-files design/stitch-v3.2` shows tracked design files. No production runtime may depend on reading HTML from this folder; it is development reference material only.

`screen.png` is an image reference, `code.html` is an implementation hint (not a component). **Never embed the raw Stitch HTML with Tailwind CDN, copied inline scripts, or repeated page shells.**

## 4. Screen coverage: exact v3.2 frames

Frames with the same route represent different **states** of one page, not independent page components.

| Frame | Visual reference / scenario | Intended route or UI placement | Requirement |
|---|---|---|---|
| A1 | Assistant welcome | `/buyer` | Empty state + composer + 4 prompt suggestions |
| A2 | Agent working | `/buyer/conversations/[id]` | 3-step progress, persistent composer, accessible activity |
| A3 | Purchase proposal | conversation | One compact recommendation, price/quantity, Review & approve; alternatives/details expandable |
| B1 | Buyer-only waiting approval | conversation | No unauthorized approve; live pending status + edit via chat |
| B2 | In-context basket review | conversation drawer | Reusable 420px review panel; keep chat visible/usable |
| B3 | Proposal v2 supersedes v1 | conversation | Old v1 read-only/invalid, What changed summary, new approval |
| B4 | Why this product? | conversation | Explain without invalidating current proposal |
| B5 | Rejected and recovery | conversation | Rejection reason, disabled old CTA, suggest revision |
| B6 | Mandatory safety constraint blocked | conversation | Fail-closed, request alternative, no bypass approve |
| B7 | Order recorded | conversation | Recorded order, link to detail, no false supplier/payment claim |
| B8 | To review inbox | `/approvals` | Pending + history, source, same approval identity as chat |
| B9 | Approval detail | `/approvals/[id]` | Full basket/taxes/date, approve/reject, ask assistant to revise |
| B10 | Checkout unavailable | `/checkout/[id]` | Order summary, payment unavailable; no fake gateway |
| C1 | Restocking overview | `/restocking` | Low stock, plans, recent checks, quick review/discuss |
| C2 | New restock plan | `/restocking/new` | What/How Much/When form, default prepare for approval |
| C3 | Restock run results | `/restocking/runs/[id]` | Ready, partial/late, unknown; excluded issues visible |
| C4 | Recipes library | `/recipes` | Search, cards, create recipe |
| C5 | Recipe detail/editor | `/recipes/[id]` | Ingredient units/yield, edit/create version as backend allows |
| C6 | Meal batch plan | `/recipes/[id]/plan` | Portions scaling, stock coverage, substitutions, review proposal |
| C7 | Recipe ambiguity/allergen in assistant | conversation | Recipe picker and safety block as **separate conditional states** |
| D1 | Orders list | `/orders` | Search/filter, statuses, origin, view detail |
| D2 | Order detail | `/orders/[id]` | Lines, authorizer, event history, continue checkout |
| D3 | Administration agents | `/admin/agents` | Agent registry; development tools in account menu |
| D4 | Agent policy editor | `/admin/agents/[id]` | Human vs Autonomous modes; real existing settings vs unsupported advanced toggles |
| D5 | Activity & Audit | `/audit` | Readable events; evidence drawer; global audit mock until real endpoint |
| D6 | Integrations | `/integrations` | Real connection statuses only; REST/MCP details and unavailable states |
| D7 | Dark theme reference | Same conversation as B3 | **No separate route**; dark semantic tokens, same geometry |
| D8 | Mobile assistant | Conversation at 390px | Bottom tabs + persistent composer; note exported PNG is 1600x1280 despite its label |
| D9 | Mobile recipe plan | Recipe batch at 390px | Responsive ingredient groups, CTA, chat access |

**Missing in Stitch but required for complete functional product:** organization members page, effective preferences and layered policies, recipe create/unsaved edit flow, restock plan details/edit/pause, empty/error/loading states, login/signup flows, not-found/forbidden, real catalog/manual buyer picker, order quote expiry and price conflict, account menu/notification contents. Design these within the established system; do not leave blank placeholders if an equivalent backend route exists.

## 5. Unified design implementation

Implement a single consistent design system as semantic CSS tokens in `src/app/globals.css` and reuse components under `src/components/`. The repo `docs/DESIGN-SYSTEM.md` is **v1.0**, while exported Stitch `DESIGN.md` contains some old **v2.1** copy (`Demo checkout`, demo strip). **The supplied UX-CHANGELOG v3.2 and this task take precedence for navigation, copy, disclosure and interaction.** Update `docs/DESIGN-SYSTEM.md` to remove those conflicts, while preserving its accessibility and component consistency guidance.

**Global:** header **64px**, desktop sidebar **248px**, generous whitespace, minimal container depth, constrained reading width, accessible primary action. Primary navigation: **Assistant, To review, Restocking, Recipes, Orders**, with **Settings & Administration** in secondary position containing Agents & Policies, Activity & Audit, Integrations, Organization.

Reusable controls: `AppShell`, `AppHeader`, `AppSidebar`, `MobileNavigation`, `AccountMenu`, `ThemeToggle`, `NotificationsPopover`, `PageHeader`, `StatusBadge`, `ProductLine`, `PriceDisplay`, `OrderSummary`, `ApprovalCard`, `BasketReviewDrawer`, `ConversationComposer`, `AgentProgress`, `RecipeIngredientRow`, `RestockPlanCard`, `EvidenceDisclosure`, `EmptyState`, `ErrorState`, `LoadingState`, `ConfirmationDialog`.

**One component, one look everywhere:** same `ApprovalCard` for chat/inbox/detail semantics (variants allowed); same purchase/price/quantity formatting; same status mappings; no per-page inline green badge invention. Light/dark switch changes only theme tokens (not fonts, geometry or markup); prevent hydration flash. Use existing theme provider if working.

**Visible wording:** remove `Simulated`, `Simulation`, `Mock`, `Demo`, `Demo checkout`, `SIMULATED_CONFIRMED` from customer-facing screens, cards, nav and toasts. **One** neutral `Development` indicator in header. Internal DTO names and tests retain correct statuses. Use truthful display wording: `Purchase proposal`, `Ready for review`, `Order recorded`, `Payment unavailable`, `Not connected`, `Availability not confirmed` as appropriate. Do not show `Paid`, `Supplier confirmed`, `Delivered`, or `Reserved delivery slot` without evidence. Do not hide operationally material uncertainty just to make UI cleaner; place provenance and integration limitations in details.

**UI density:** start screen one query composer, main view one current recommendation/next action, alternatives and technical evidence collapsed; avoid nested cards/grids that obscure the user goal.

**Responsive:** test 1440, 1280, 768, **390** widths, both themes, 200% zoom, keyboard focus, screen-reader labels. D8 is a composition reference, not a real 390px full-size screenshot.

## 6. Data-layer architecture: two isolated implementations, one facade

Target conceptual boundaries:

```
UI / route pages / hooks
       ↓
Feature controllers (buyer, purchasing, approvals, recipes, restocking, settings)
       ↓
src/client/api-client.ts + domain adapters (typed)
       ├── ConnectedAdapter → existing Hono endpoints and shared Zod DTOs
       └── MockAdapter → deterministic fixtures + isolated local state
```

Use a common **presentation model** to keep page components independent of server DTO shape. In the **connected** adapter map actual `src/shared/contracts/*` schemas into that model. In **mock** adapter use deterministic fixtures validated by provisional Zod schemas; do **not** pretend they are server contract types. No fixtures imported directly into React UI.

### Mode semantics

- `NEXT_PUBLIC_USE_MOCKS=true`: no server requirement; coherent scripted flows, isolated browser persistence and clearly internal demo scenario controls under `Account → Development tools`.
- `NEXT_PUBLIC_USE_MOCKS=false`: real login/session, real catalogue/search/prices, **real purchasing proposal/approval/order APIs**, real preferences/members/inventory/recipes where available. Only unavailable feature groups use isolated local placeholders; they cannot alter the authoritative server purchasing record.
- Never silently fallback from a failed **real purchase/approval/order call** to a successful local simulated one. Show error and retry.
- Partial real mode can use a mock **chat presentation**, but **approval and order state must remain server authoritative**. Display a locally scripted agent card only as a UI exploration aid, not as a true AI action.
- No fake server-wide sync of restock plans, recipe edits, notifications, or agent credentials.
- Unavailable backend feature: useful read-only or local-only UI with clear behavior, docs note and explicit indication when saving is not server-persistent. Do not clutter every screen with repeated mock disclaimers.

### Session/roles

Connected `GET /api/me` exposes `buyer` and `approver` only; users can hold **both**. Treat “Settings & Administration” as approver-authorized UI where appropriate, **not** an invented `admin` API role. A Buyer+Approver sees actions allowed by server. The backend currently allows self-approval for this role combination. Do not create an arbitrary role switch in connected mode. Mock user switching only in Account > Development tools.

### No duplicate orders

When connected, use server-issued proposal/approval/order IDs; store UI references only. Real server handles transactions, idempotency and hash binding. Never use local browser provisional `proposalHash` as real backend proof; never create an independent local order after a successful POST to backend. Handle 200 replay and 201 created equivalently.

## 7. Real HTTP API integration map — inspected paths

All endpoints are **under `/api`, not `/api/v1`**. Use the existing Hono URLs and Zod types; inspect code for exact request shapes and response envelopes.

| Feature | Method + route | Connected mode implementation |
|---|---|---|
| Session | Better Auth `/api/auth/*`, `GET /api/me` | Use existing auth client/viewer |
| Catalog search | `GET /api/products` | Real manual search, results, pagination where supported |
| Product detail | `GET /api/products/{id}` | Details/units/allergens/suppliers |
| Offer | `GET /api/products/{id}/offer` | Product-specific price/availability |
| Offers batch | `POST /api/offers` | Date-scoped shortlisted IDs only, not full catalog polling |
| Advanced search | `GET /api/catalog/products` | Structured search where needed |
| Advanced details | `GET /api/catalog/products/{productId}` | Dietary/CO2/reliability evidence |
| Substitutions | `POST /api/catalog/substitutions` | Candidate ranking/splits, confirm real response shape |
| Policy preview | `POST /api/policy/evaluate` | Existing policy engine, use server decision |
| **Create purchase proposal** | **`POST /api/proposals`** | Core purchase intake from selected lines |
| List proposals | `GET /api/proposals` | Own/all proposals as authorized |
| Read proposal | `GET /api/proposals/{id}` | Re-fetch on review/refresh |
| Cancel old proposal | `POST /api/proposals/{id}/cancel` | Supersede previous actionable revision safely |
| Request approval | **`POST /api/proposals/{id}/approval`** | Start human review when required |
| List approvals | **`GET /api/approvals`** | Approver inbox; server state shared across users |
| Decide approval | **`POST /api/approvals/{id}/decision`** | Send decision, exact `proposalHash`, rejection comment |
| **Commit recorded order** | **`POST /api/proposals/{id}/order`** | Idempotency key, quote revalidation, server transaction |
| Orders list/detail | `GET /api/orders`, `GET /api/orders/{id}` | Core purchasing record (canonical) |
| Preferences effective | `GET /api/preferences/effective` | Buyer/approver-effective values |
| Preferences layers | `GET /api/preferences/layers` | Approver settings UI |
| Update preferences | `PUT /api/preferences/layers/{scope}` | Layer values/locks, preserve inheritance |
| Organization members | `GET /api/organization/members` | Actual team roster |
| Create member | `POST /api/organization/members` | New colleagues under org |
| Change member roles | `PUT /api/organization/members/{userId}/roles` | Role changes; enforce server constraints |
| Inventory | `GET /api/inventory` | Stock overview and recipe coverage, freshness only if available |
| Upsert inventory | `POST /api/inventory/items` | Supported inventory item editing |
| Replace inventory | `PUT /api/inventory` | Bulk sync; strong confirmation before replacing all |
| Adjust inventory | `PATCH /api/inventory/items/{itemId}` | Update quantities/par levels |
| Recipes list/detail | `GET /api/recipes`, `GET /api/recipes/{recipeId}` | Real recipe data |
| Create recipe | `POST /api/recipes` | New recipe; no server edit endpoint yet |
| Stock alerts | `GET /api/intelligence/stockout-alerts` | Real-derived warnings/shortages where possible |
| Recurring anomalies | `POST /api/intelligence/recurring-check` | Real backend comparison for repetition |
| Proactive recommendations | `GET /api/intelligence/recommendations` | Optional low-priority content |
| AI agent (non-stream) | `POST /api/agent/run` | **Treat as separate legacy/agent flow.** No structured SSE. Verify that calls cannot inadvertently create or check out an order. Do not route unreviewed free text there by default. |
| Alternate order flow | `POST /api/orders`, `POST /api/orders/from-recipe`, `PATCH /api/orders/{orderId}`, `POST /api/orders/{orderId}/approval`, `/checkout`, `/receipt`, `/audit`, `/verify` | Different **`src/shared/contracts/orders.ts`** model. Do not mix with `purchasing.ts` order IDs/types. Use only after explicit safe flow reconciliation; otherwise keep scoped UI fallback. |

**Missing from route inventory (must not invent live endpoints):** global `/api/audit`, `/api/restock-plans/*`, `/api/restock-runs/*` durable scheduler, `/api/recipes/{id}` PATCH/PUT/DELETE, external agent credential CRUD, a structured streaming chat endpoint, native `/mcp` service, real supplier ordering/payment service.

## 8. Canonical purchasing workflow — approval-first

**All order sources** (Assistant, manual catalog, Restocking, Recipes/Meal Plan, repeat order, external agent) must produce or ultimately reference the same **immutable purchase proposal**, then the same server approval/order workflow.

### Connected sequence

1. Resolve actual user and capabilities from `GET /api/me` and effective org preferences. Fetch/catalog shortlist and actual offers; never infer supplier facts from an LLM or design screenshot.
2. Build `CreateProposalRequest` with `{ lines: [{ productId, quantity /* SALES UNITS */ }], date, note }`; validate required fields and conversions with existing shared Zod contract. Display missing conversions as “Needs confirmation”; do not silently parse all litres from names.
3. `POST /api/proposals` returns immutable proposal and server policy decision (`READY`, `BLOCKED`, etc.), hash, `quoteExpiresAt`, line data, total **excl VAT**.
4. **Default human approval:** if outcome is `REQUIRE_APPROVAL`, `POST /api/proposals/{id}/approval` and show `PENDING_APPROVAL` (or require explicit “Send for review” depending on UX). Even an exact-match basket normally follows approval-first policy. Never bypass backend decision. If `ALLOW` only because an explicitly configured policy allows it, UI may offer/execute autonomous flow as authorized; never hardcode frontend auto-approval.
5. For user with `approver`, provide **same** review actions in chat and To Review. `POST /api/approvals/{id}/decision` with exact server `proposal.hash`. A Buyer-only user gets status, not approval buttons. Self-approval is allowed only when backend authorizes it.
6. On approval, re-read server proposal, check expiry/conflicts, then `POST /api/proposals/{id}/order` with one stable idempotency key generated for this attempt. Server revalidates real price/availability and returns same order for replay.
7. Render **Order recorded**, navigate to `/orders/{id}` or `/checkout/{id}`. Checkout shows payment unavailable rather than pretending real charge. Keep internal `SIMULATED_CONFIRMED` only in contracts/code.

### Price and policy semantics

- The **server purchasing contract uses EUR numbers excluding VAT**. The old frontend provisional model uses minor-unit **strings including VAT**. Implement explicit parse/format/adapters, not blind spreading of DTOs.
- Label policy limit as **excl. VAT**; if gross can be safely calculated from verified tax values, label **incl. VAT**. Do not invent a fixed 14% rate across all products; if gross unavailable, display available exact net amount and explain why.
- `quoteExpiresAt` is a functional deadline, not decorative metadata. After expiry/new quote: offer “Refresh prices & prepare updated proposal”. Preserve same message thread with new proposal ID.
- Handle 409 `QUOTE_EXPIRED`, `PRICE_CHANGED`, `AVAILABILITY_CHANGED`, `HASH_MISMATCH`, `INVALID_STATE`; display precise next safe action. Disable stale buttons.
- Product unit `salesUnit`, physical requested measure, pack counts, source, `allowedLotSize` must be visible at least under evidence. Unknown conversions/terminal availability must never appear as verified stock.
- `POST /api/offers` for shortlisted products only; respect Valio rate limits.

## 9. Continuous conversation and immutable proposal revisions

**The conversation input is never removed when a proposal, approval, substitution selector, policy issue, rejection or checkout-ready card is shown.** On desktop keep it as a sticky bottom composer in the central conversation; on mobile above bottom navigation and keyboard. It must remain keyboard accessible.

A conversation may contain multiple immutable proposals:

```
Conversation 102
  user request -> proposal P1 (server ID; review A1)
  user changes quantity -> P1 cancelled by server; A1 cancelled by server
  proposal P2 (new server ID; review A2)
  user asks "Why that one?" -> answer; P2 stays active
  approver accepts P2 -> order O2
```

Rules:

- **Material change:** quantity, brand/product, delivery date, budget, allowed substitute, mandatory constraint or recipe/restock inputs → new proposal and approval request. Cancel pending old proposal using real `POST /api/proposals/{id}/cancel`; old history becomes **Superseded** only once the cancellation succeeds. Old chat card is read-only; stale approvals become non-actionable.
- **Informational question:** “Why this product?”, “What's the unit?”, “Compare these options” → answer without invalidating proposal.
- **Rejected proposal:** preserve reason, offer revision, never resurrect rejected approval.
- **Order already recorded:** cannot retroactively edit original server order through chat. Start a new inquiry/request or use a specifically supported post-order action with confirmation.
- **Race:** after attempted cancel/approve from multiple tabs, fetch server state. On 409 show current status. Never blindly assume local supersession succeeded.
- **Chat AI gap:** current `/api/agent/run` is non-streaming and may have purchasing side effects; until backend provides a safe structured chat/stream contract, use deterministic frontend-only message handling and real **manual proposal flow** beneath it. Do not label scripted messages as live agent execution or call a side-effectful endpoint from an unsupervised input without explicit user action.
- Store UI conversations/revision linkage in a browser-local view model until backend provides conversation persistence. In connected mode rehydrate linked server proposals/orders from backend on reload and note that full transcript is local-only if so. No invented cross-device chat synchronization.

## 10. Inline approval and To Review: ONE approval entity

- Shared `ApprovalCard` shows product basket, quantities, review reason, pricing semantics, expiry, substitution warnings and actions.
- If current user has Approver permission, show “Review & approve” / “Reject”; same underlying `approval.id` and `proposal.hash` as `/approvals/[id]`.
- If Buyer only, show “Waiting for an approver” and link to status; no fake permission bypass.
- If approval is expired/cancelled/rejected/superseded or proposal content changed, the card becomes read-only and names the new/current version where known.
- The review drawer must not hide or disable the chat composer. When a material edit begins, close/disable stale review drawer.
- Rejection asks for a reason (server requires it); approval action uses a confirmation step and disables duplicate submits.
- Inbox pending count derives from actual `GET /api/approvals` when authorized, not hardcoded. Buyer-only may see their proposal's own status via GET proposal, not the approver-only approval list.
- Approving is **not** the same as billing/payment; proposal → approval → revalidation → recorded order → payment unavailable.

## 11. Manual product ordering — MUST WORK even without chat backend

Implement a real buyer workflow from existing catalogue data:

1. Search `GET /api/products?q=...` using actual query schema, with debounce and empty/loading/errors.
2. Select eligible product details/quantity in **sales units**; show unit, pack/physical size if verified, allergens, country, availability certainty.
3. Lookup prices/availability for selected shortlist via `POST /api/offers`.
4. Preview evaluation via `POST /api/policy/evaluate` (advisory only; server recalculates on proposal).
5. Create immutable server proposal. Review items, adjust via new proposal if needed, submit for approval, approve, record order.
6. Show quote expiry, net/gross distinction, rejection and reapproval requirements.
7. Provide path back to Assistant so the chat can explain or revise the result without bypassing the above flow.

Avoid hard-coded SKU → litre maps in connected purchasing; add a visible “Conversion needs review” state if trustworthy physical content is unavailable.

## 12. Restocking — implement entire UI, real APIs where possible, fallback for plans

Routes and experiences: `/restocking`, `/restocking/new`, `/restocking/plans/[id]` (if needed for edit), `/restocking/runs/[id]`, from chat.

- Overview prioritizes **Needs attention**, **Your restock plans**, **Recent checks**, not metrics overload.
- Form stages: What (ingredient/product, location), How Much (reorder threshold, target, current stock), When (schedule/interval, preparation mode). Defaults to **prepare proposal for review**.
- Get real inventory via `/api/inventory`; optionally show actual stockout intelligence via `/api/intelligence/stockout-alerts`, real catalog and offers. Label stale/unknown snapshots accurately.
- Backend has **NO durable restock plan CRUD and NO scheduler** in inspected snapshot: use a frontend-local **restock plans service** with local persistence. Clearly distinguish *configured locally* from *running unattended on a server*. Never promise timed execution while browser is closed. Provide **Run check now** and deterministic illustrative check history.
- The run groups Ready / Partial or late / Availability not confirmed; uncertain items remain visible and are not automatically treated as available.
- Compute `needed = max(0,target - usableStock)` only where units/sources are compatible; distinguish on-hand, reserved and inbound when available. Prevent obvious duplicate coverage by pending proposals; explain when no backend reservation data exists.
- When run creates a purchase, pass **only validated orderable lines** to canonical `/api/proposals` flow, then human approval. If real proposal call fails, **do not create local 'recorded' order** in connected mode.
- Allow user to converse: “Restock cheese to 30kg instead” → update draft plan, regenerate proposal; invalidate old approval if server confirms cancellation.
- Include plans with weekly/threshold modes and exception scenarios; use `data/valio`/fixtures only through adapters, do not require catalog calls for every product each minute.

## 13. Recipes, 1,000 portions, and substitutions — complete UI

Routes: `/recipes`, `/recipes/new`, `/recipes/[id]`, `/recipes/[id]/plan`, and conversation inline recipe picker.

- Real backend supports **list/get/create**, not recipe PATCH. Connect these 3 actions via shared `recipes.ts` schemas. For editing, implement a local draft with a clear save limitation; do not claim “Saved to server” unless a supported route exists. Do not convert an edit to a new recipe silently.
- Render recipe title, serving yield, ingredient names/amounts/units, allowed substitutes, dietary evidence, version reference where present.
- Plan batch: choose 1,000 portions; scale recipe ingredient quantities by ratio; compare with actual `/api/inventory` stock; group **In stock / Need to purchase / Needs attention**; preserve physical-vs-sales-unit provenance.
- Ambiguous recipe prompt offers a simple choice of variants before purchasing. Recipe detail screen should not combine unrelated allergen block into every state.
- Use `POST /api/catalog/substitutions` for real supported substitution suggestions when type and safety checks match; **never** automatically accept unknown allergen/quantity conversions.
- “No substitute” returns needs-attention/block status; still allow conversation and change of recipe/ingredient.
- Existing `POST /api/orders/from-recipe` returns the **alternate order model**. DO NOT equate it to canonical proposal creation or call it automatically just to make a UI button work. Derive validated purchasable product lines and submit through `/api/proposals` when possible; otherwise show “Review needs attention” and keep the recipe batch plan as local draft.
- Add manual recipe creation page with ingredient editor and validation; support deterministic mock recipe fixtures for unsupported editing/versions.

## 14. Orders & checkout

- In connected mode read canonical `GET /api/orders` and `GET /api/orders/{id}`, not browser-session provisional orders. Map `status: SIMULATED_CONFIRMED` internally to UI **Recorded**.
- Order details: source (Assistant/Restocking/Recipes/manual where client knows), item list, total **ex VAT**, authorizer where evidence exists, date, life-cycle timeline, links to proposal and chat.
- Checkout route `/checkout/[id]` must be a **read-only payment availability experience** for canonical orders: show “Payment unavailable” and meaningful return/navigation, never pretend a real charge exists. Do not call `POST /api/orders/{orderId}/checkout` for a `purchasing.ts` order: that endpoint is from the **different legacy order model**.
- Do not show delivery confirmed unless supplier confirms it; availableDate is not a reserved fulfillment slot.

## 15. Settings & Administration

Implement the real app shell sub-navigation: **Agents & Policies**, **Activity & Audit**, **Integrations**, **Organization**.

### 15A. Agent registry

- Recreate D3 style. Internal/scheduled/external agent rows with statuses only when supported by actual API. There is no agent registration/credential CRUD in the backend snapshot; represent missing actions with disabled state and meaningful reason, or deterministic local preview under Development tools. **Do not issue fake usable credentials**.
- Use no made-up MCP server URL. Link to actual `/api/docs` and inspect documented endpoints. External agent management is a known backend blocker.

### 15B. Real policy settings

- Implement `GET /api/preferences/layers`, `GET /api/preferences/effective`, `PUT /api/preferences/layers/{scope}` with `src/shared/contracts/preferences.ts`.
- Role-layer `base/buyer/approver` inheritance; `locked` only on base; handle server 409/422 and validation; avoid clobbering entire layer accidentally. Show configured and effective source.
- Two clear UI modes: **Human approval** (default: `autonomy=suggest_only`, `autoApproveBelow=null`) and **Autonomous with guardrails** (`order_within_limits` + explicit limits). Do not imply selecting UI mode alone changes policy until persisted and server confirms.
- Current backend supports `maxOrderValue`, `autoApproveBelow`, `autonomy`, `allowSubstitutes`, allergen and vendor/brand preferences, etc. It **does NOT yet separately enforce** advanced “exact-match-only / preference substitution / +X% spend / mandatory substitution” toggles from v3.2 design. Expose unsupported advanced options as disabled/roadmap or mock-only drafts, not as working policy switches.
- Hard safety requirements stay non-bypassable; no “approve anyway” for unverified allergen compliance.

### 15C. Organization members

- New screen `/admin/organization` or `/settings/organization` consistent with D3 tabs; connect `GET/POST /api/organization/members` and `PUT /api/organization/members/{userId}/roles`.
- Support users with BOTH Buyer and Approver roles. No fake `admin` role: approver has management permission in current contract. Respect last-approver protection and show server errors.
- Never leak passwords/credentials in UI or log them.

### 15D. Audit / Integration

- Audit list uses readable events, filtering and evidence drawers. Use local conversation events plus any **matching** real per-order evidence; no `/api/audit` yet. State data provenance in details and do not advertise global tamper-proof log.
- Integrations surface actual health of Valio backend and route availability. Current project has REST/OpenAPI, but no confirmed public external MCP endpoint. Label appropriately; remove invented production gateway, EDI and payment URLs.
- Notifications popover should reflect actual approvals/alerts, never static bogus counts; otherwise show empty state.

## 16. Mock fixtures and scenario completeness

Mocks must remain deterministic, validated, realistic, **explicitly temporary in docs/code**, and isolated behind `src/client/` services. In development mode provide scenario selection from Account > Development tools (not the main buyer view). Don't show the literal words Demo/Mock/Simulated in the customer-facing interface.

Required interactive scenarios:

1. **Default approval-first exact match:** 100 L lactose-free milk, correct package math, human review despite matching budget; create one recorded local order in full mock mode, or one real canonical order in connected mode.
2. **Buyer-only:** proposal pending another approver; no Approve action.
3. **Buyer+Approver:** self-approval from chat, same result visible in To Review, then order; idempotency tested.
4. **Revision while pending:** 100→150 L; cancel old proposal/approval, show superseded state, new proposal ID/hash and fresh approval.
5. **Information-only follow-up:** “Why this product?” does not change proposal revision.
6. **Reject & retry:** reject with reason, propose revised quantity and new request.
7. **Hard allergen unknown:** block, no bypass via approval, suggest safer options only when verified.
8. **Expiry/price conflict:** 409 response, no order, refresh and new proposal path.
9. **Restock cheese:** stock 8 kg, threshold 12 kg, target 40 kg => shortage 32 kg; verify case conversion and unknown details; generated proposal requires review.
10. **Restock mixed availability:** Ready, partial/late and unknown items; clearly excluded unresolved item.
11. **Restock plan via chat and manual form**, same UI record; manual Run check; do not claim background scheduling.
12. **Recipe 1,000 portions:** choose among two recipes, scale ingredients, compare inventory, verify replacements, prepare proposal, review and order.
13. **No safe substitute:** unresolved mandatory restriction; cannot auto-approve.
14. **Recipe creation** with actual API where possible; editing existing recipe as local draft until backend edit endpoint exists.
15. **Autonomy explicitly enabled:** only if current server policy/fixture supports; show exact rule; blocked hard constraints stay blocked.
16. **Order checkout:** recorded order, checkout/payment unavailable; no fake paid outcome.
17. **Connected vs mock:** real mode never silently creates a local purchase after a failed server call.
18. **Multi-user connected:** buyer and approver signed in separately see same server-side approval and resulting order after refresh (if backend environment available).

Demo numerical values in Stitch are examples, not hard-coded evidence. Where local fixtures are used, label fixture provenance in expandable details, not as repetitive warning banners.

## 17. Error, loading, refresh, security and concurrency behavior

Implement consistent common patterns for:

- Loading skeletons / empty lists / no results / first-time states.
- Authentication expired (401), denied (403), not found (404), Zod validation (400/422), server/unavailable (500/502), connectivity/no DB.
- Purchasing 409s: `QUOTE_EXPIRED`, `PRICE_CHANGED`, `AVAILABILITY_CHANGED`, `HASH_MISMATCH`, `INVALID_STATE`, already finalized, stale approval.
- Duplicate button clicks, concurrent approval in another tab, proposal cancellation race; singleflight action requests, stable idempotency key and refetch.
- On refresh: preserve local message draft and presentation state if possible, but trust real server proposal/approval/order status. Interrupted client-only run never auto-commits.
- No unsafe HTML or prompt injection via product descriptions, chat text or server messages; never render unsafe HTML as trusted.
- Permissions are always server-authoritative; UI role gating is convenience only.
- In development mocks, browser storage is not server-backed authorization or actual scheduler.
- Do not log or surface auth cookies, API keys, passwords or sensitive request payloads.

## 18. Testing and verification — comprehensive

### Initial baseline

- Inspect `git status`, active branch and exact environment; preserve existing changes.
- Run `pnpm check`, `pnpm test`, and `pnpm build` as baseline if dependencies/runtime available; document baseline failures separately.
- Ensure `.env` not tracked and Stitch assets are available (or document blocker).

### Unit/service tests

- API adapters: Zod parses actual response shapes; correct numeric EUR net vs gross mapping; no accidental inferred VAT.
- Proposal creation/cancel/reapproval; idempotency, hash binding, quote expiry handling.
- State selectors and shared approval store for chat/inbox; role capabilities.
- Recipe serving math, inventory unit conversions, substitution fail-closed, restock target math.
- Local-only restock persistence and “no real scheduler” semantics.
- No fallback after real HTTP failure; mock mode doesn't make production purchasing calls.

### Browser acceptance

Run at **1440, 1280, 768, 390**, light/dark/system, including keyboard tab order, screen reader labels, zoom 200%, console/hydration errors. Verify all 29 frames/conditions through UI paths, not only screenshot comparison.

Specifically verify:
- One shared header/sidebar and consistent status badge/buttons across all routes.
- Persistent composer during proposal, review drawer, rejection and allergen block.
- Chat approval and To Review approval show same object and same status.
- Real connected proposal/approval/order survives two separate browser sessions/accounts.
- All actions either work or visibly report why they cannot; no inert buttons.
- 409 conflict and expiry don't accidentally record an order.
- Orders list/detail and checkout respect server source of truth.
- Dev scenario controls located only under account menu.
- No “Simulated/Mock/Demo” visible in product UI; only `Development` in header, without deceptive supplier/payment claims.
- Real browser 390px layout, especially C6, B2, D8 and D9; no horizontal overflow/covered composer.

If Docker/DB/keys are unavailable, fully test `NEXT_PUBLIC_USE_MOCKS=true` and build `NEXT_PUBLIC_USE_MOCKS=false`, write exactly which connected tests could not be executed. **Do not mark a real integration tested based only on compile success.**

### Required commands

```
pnpm check
pnpm test
pnpm build
```

If the repo's test runner supports browser tests, run it. Avoid adding new test frameworks if not already available; use existing Chromium/Playwright tooling where available and report limitation honestly.

## 19. Checklist and integration-status reconciliation

After implementation, update documentation as a formal handoff:

1. Root `CHECKLIST.md`: check off **frontend** entries only when verified; preserve open backend and agent checkboxes. Add missing v3.2 requirements as separate clearly-owned items if useful. **Do not tick an agent or backend checkbox solely because a frontend mock screen exists.**
2. `docs/INTEGRATION-STATUS.md`: for each group mark `CONNECTED_TESTED`, `IMPLEMENTED_NOT_TESTED`, `MOCK_ONLY`, `NOT_CONNECTED`, or `BLOCKED_BY_BACKEND`, with exact endpoint(s) and evidence.
3. Remove stale `/api/v1/**` assumptions from active frontend integration guides (leave historical docs as historical if appropriate).
4. List remaining backend requests: secure streaming chat; default-deny; scoped external agent keys/MCP; global audit; durable restock plan/scheduler; recipe update; advanced autonomy policy toggles; verified physical quantities.
5. Record migrations/gateway/DB conflicts rather than changing backend yourself.
6. Update or delete `src/client/provisional/unavailable-service.ts` only if unused; remove `real-catalog.ts`/scripted connected glue only after real adapter demonstrably replaces them.

## 20. Execution sequence — one end-to-end implementation task

Work autonomously in a sensible order, but **complete all frontend scope before stopping**:

1. Audit exact code and design; create a short internal work plan and map reusable components.
2. Ensure design files are accessible and tracked; build common tokens, shell, nav, status/price components, theme and responsive foundations.
3. Implement typed **real purchasing adapter** and separate mock adapter with tested mapping; connect list/details/quote/approval/order.
4. Rebuild Assistant + real manual buyer/product picker, continuous conversation and approval-first revisions.
5. Implement To Review, Orders/Detail, Checkout, notifications, error handling.
6. Implement Restocking and Recipes with backend read/write where supported and isolated mocks for missing scheduler/editing.
7. Implement Settings & Administration: policy layers, membership, agents UI, audit and integrations.
8. Finish all screen states, light/dark/mobile, unified UI controls and interaction polish.
9. Run unit/integration/browser tests; fix regressions; update checklist and integration docs; provide final verification report.

### Final response required from Codex

Report:

- Every implemented route and screen state (reference A1–D9).
- Which exact APIs are **connected and tested**, connected but untested, mock-only, backend blocked.
- Changes made and file paths.
- Unit, browser and build results, with command output summary.
- All open checklist items with responsible owner and specific follow-up.
- Screenshots for core flow, restock, recipes, approval, settings in desktop light, desktop dark and mobile if tooling supports.
- Any dependencies, migrations or backend owner decisions needed — do not imply they're done.

## 21. Acceptance bar

**Success means the app looks like one thoughtfully designed product, supports the full end-to-end human-approved purchasing journey, uses existing real purchasing/recipe/inventory/settings APIs wherever available, and provides deterministic coherent mock states only for genuinely missing functions.** It must be possible to demonstrate the complete UX without requiring a live external Valio order/payment API, while connected mode never misrepresents a locally fabricated purchase as an accepted server record.

Don't replace the project, don't create a competing backend, and don't stop after only implementing prettier screenshots. This is an implementation of the **complete** frontend product described above, not another mockup generation exercise.
