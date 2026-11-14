# Aimo TrustBridge — Frontend Mock Strategy & Provisional Integration Contract

**Status:** `PROVISIONAL / FRONTEND-ONLY / NOT APPROVED BY BACKEND`  
**Owner:** Frontend developer (Codex)  
**Purpose:** Allow independent, credible frontend development while the backend developer is unavailable.  
**Last reviewed:** 2026-11-14  
**Applies to:** `junction-2026`, branch `frontend`  
**Important:** This document is an implementation proposal, **not** evidence that the corresponding HTTP endpoints or business logic exist.

## 1. Order of authority and safe boundaries

Read, in order:

1. Root and zone-specific `AGENTS.md` — code ownership and security constraints.
2. `docs/VALIO-CLIENT-TASKS.md`, especially **Appendix A** — proposed application routes, DTO field names, enums and SSE events.
3. `docs/VALIO-SERVER-TASKS.md` — intended server behavior and integration risks.
4. `docs/DESIGN-SYSTEM.md` — authoritative colors, typography, layout, behavior.
5. `design/stitch/` — **non-authoritative** visual references; do not copy inconsistent layouts.
6. **This document** — temporary frontend implementation decisions and explicit integration uncertainties.

**Never create/modify** `src/server/**`, `src/app/api/**`, or `src/shared/contracts/**` without the backend owner's explicit agreement. Do not change root dependencies (`package.json`/lockfile), root project config or CI to implement mock behavior without coordinating with the owner. Do not create fake production integrations or claim these future routes are operational.

### 1.1 Architecture decision

Keep a single browser-facing API facade: `src/client/api-client.ts`. UI components **never** call `/api/v1/**` directly, import backend modules, or calculate policy/price/stock/unit conversions.

```text
src/features/** and src/app/**
        |
        v
src/client/api-client.ts            <- only client-facing data facade
        |
        +-- mock adapter  (NEXT_PUBLIC_USE_MOCKS=true)
        |       +-- frontend-local provisional DTO/view models
        |       +-- scenario fixtures + stateful demo store
        |       +-- simulated event stream
        |
        +-- real HTTP adapter (after agreed Zod contracts + backend routes exist)
                +-- src/shared/contracts/*  <- future joint canonical validators
                +-- POST fetch SSE parser
```

The **shared Zod schemas do not exist yet** except health. Until both developers agree, do not create a competing canonical `src/shared/contracts` domain model. Temporary types may live **only inside `src/client/provisional/`**, and must be identified by `Provisional` names or annotated as `TODO BACKEND-CONTRACT`. This is a narrow, temporary departure from the target architecture, not permission to change shared contracts. Use `zod` already installed to validate fixtures **locally**, then remove/replace the provisional validators once the joint contracts arrive. The existing health client must continue working.

Suggested frontend-only files (adapt to the actual repo after inspecting it):

```text
src/client/
  api-client.ts                 # existing entry point, retain getHealth()
  provisional/
    types.ts                    # temporary DTOs mapped field-for-field to Appendix A
    validators.ts               # frontend-local Zod; not canonical
    contract-map.ts            # optional route -> method mapping
  mocks/
    scenarios.ts               # scenario definitions, no true supplier claims
    fixtures.ts                # stable, contract-shaped objects
    mock-api-client.ts         # stateful in-memory fake service
    mock-agent-stream.ts       # async simulated AgentEvent sequence
  http/
    http-api-client.ts         # later, not required for the first UI milestone
    parse-sse.ts               # later or as independently tested utility
src/features/
  buyer/                       # renders data, no business-policy decisions
  approvals/
  orders/
  ...
```

It is acceptable to **first complete the application shell** and implement the mock adapter in the following milestone. Do not rewrite an in-progress shell implementation merely to introduce mocks early.

## 2. What is already real vs only planned

| Capability | Status in reviewed repository snapshot | In mock phase | What confirms integration |
|---|---|---|---|
| `GET /api/health` | Existing Hono endpoint and shared health schema | Keep as-is | Real health check |
| Session (`/api/v1/auth/*`) | Not implemented | Demo identity and role switching, visibly marked | Backend login/me/logout + cookie flow |
| Catalog and offers | Not implemented | In-memory synthetic product/offer fixtures | Backend product search/Valio adapter |
| AI chat and run events | Not implemented | Deterministic prompts -> scripted events | Backend POST SSE stream |
| Purchase intent/proposal | Not implemented | Typed demo state machine | Backend DTOs and endpoints |
| Policy evaluation | Not implemented | Hard-coded **scenario outcome supplied by fixture**, never browser authority | Real gateway policy service |
| Approval workflow | Not implemented | In-memory simulated approver decisions | Real approver session and API |
| Order commit | No Valio supplier order API documented | In-memory **LOCAL SIMULATOR ONLY** | Backend local Order Simulator |
| Audit | Not implemented | Demo timeline scoped to scenario | Backend audit API |
| Agent administration/MCP | Not implemented | Static demo and non-operational documentation | Backend agent registration, auth and MCP |

**Never** display a fake supplier confirmation, an invented Valio API response as live, fake authenticated security or fake availability as current. All offer prices/stocks in frontend mocks are synthetic fixture values.

## 3. Canonical proposal: use Appendix A, do not invent parallel routes

The following are **proposed internal application routes**, not currently working Valio API endpoints. Preserve names and semantics from the two task specifications. `P0` means needed for buyer/approval/orders mock; `P1` is administration/integrations.

| Priority | Frontend action | Proposed method + path | Mock method / behavior |
|---|---|---|---|
| P0 | Environment capabilities | `GET /api/v1/meta` | `getMeta()` -> `orderMode: SIMULATED_LOCAL`, fixture data mode |
| P0 | Demo user | `GET /api/v1/auth/me` | `getCurrentUser()` -> mock-only demo user |
| P0 | Login/logout later | `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` | Demo role switch **only if explicitly labelled** |
| P0 | Search products | `GET /api/v1/catalog/products` | `searchProducts(filters)` -> `Page<ProductSummary>` |
| P0 | Product details | `GET /api/v1/catalog/products/:productId` | `getProduct(productId)` |
| P0 | Check offers | `POST /api/v1/offers/check` | `checkOffers(req)` -> `OfferCheckResponse` |
| P0 | Intent list/create/detail/edit | `GET/POST /api/v1/purchase-intents`, `GET/PATCH /api/v1/purchase-intents/:intentId` | `get/create/updateIntent()`; revisions increment |
| P0 | Proposal list/create/detail | `GET/POST /api/v1/proposals`, `GET /api/v1/proposals/:proposalId` | `get/createProposal()`; immutable versions |
| P0 | Request approval | `POST /api/v1/proposals/:proposalId/request-approval` | `requestApproval()` -> pending only if fixture allows |
| P0 | Commit simulated order | `POST /api/v1/proposals/:proposalId/commit` | `commitOrder()` with mock idempotency handling |
| P0 | Approvals | `GET /api/v1/approvals`, `GET /api/v1/approvals/:approvalId` | `list/getApprovals()` |
| P0 | Approve/reject | `POST /api/v1/approvals/:approvalId/approve` or `/reject` | `approve/reject()`; demo role assertion only |
| P0 | Orders | `GET /api/v1/orders`, `GET /api/v1/orders/:orderId` | `list/getOrders()` |
| P0 | Audit | `GET /api/v1/audit` | `listAudit()` -> human-readable mock timeline |
| P0 | AI conversation | `POST /api/v1/agent/chat`, `GET /api/v1/conversations[/:id]` | `streamAgentChat()` + persisted mock run |
| P1 | Agent management | `GET/POST /api/v1/admin/agents`, `GET/PATCH /api/v1/admin/agents/:id` | agent list/detail only until admin mock step |
| P1 | Policy | `GET/PUT /api/v1/admin/agents/:id/policy` | mocked read/write with local version checks |
| P1 | Credential/revoke | `POST /api/v1/admin/agents/:id/credentials`, `/revoke` | no real credential; mock placeholder only |
| P1 | Integrations | `GET /api/v1/integrations/status` | explicit fixture/offline indicators |
| P1 | Metadata/spec/MCP | `/api/openapi.json`, `GET/POST /api/mcp` | link to existing docs; **no fake active MCP server** |

**Notice:** existing live `GET /api/health` must not be renamed to `/api/v1/health` by the frontend. The new path in Appendix A is a proposed future backend alias, and the owner must confirm it.

## 4. Provisional DTO: exact field names and enums

Do **not** create simplified competing domain types like `price: number`, `canPurchase: boolean`, `quantity: 100` or `status: 'success'` that later require extensive remapping. Mirror Appendix A, using temporary frontend-local schemas.

| Entity | Required UI fields to match Appendix A | Critical invariant |
|---|---|---|
| `SessionUser` | `userId`, `organizationId`, `displayName`, `roles` | Demo identity not authenticated |
| `Money` | `{ currency:'EUR', amountMinor:'...' }` | Decimal integer string, e.g. `"12500"` = €125.00 |
| `Quantity` | `{ value:'...', unit:'...' }` | Decimal string, never assume L = ST or KI |
| `ProductSummary` | `productId`, `name`, `language`, `salesUnit`, `baseUnit`, `allowedLotSize`, optional claims | Technical units remain technical unless verified |
| `OfferLine` | `priceGross`, `availableSalesUnits`, `availableDate`, `stockCertainty`, `blocked`, `checkedAt`, `source` | Live price/stock is **not** represented in mock |
| `PurchaseIntent` | `id`, `revision`, `status`, `items`, `preferences`, `needsClarification` | Edit creates next revision |
| `PurchaseProposal` | `id`, `intentId`, `intentRevision`, `version`, `status`, `proposalHash`, `lines`, `alternatives`, `policyDecision`, `totalGross`, `traceId` | Proposal is a frozen snapshot |
| `ApprovalRequest` | `id`, `proposalId`, `proposalHash`, `status`, `reasons` | Approval bound to proposal hash |
| `Order` | `id`, `proposalId`, `status:'SIMULATED_CONFIRMED'`, `source:'LOCAL_SIMULATOR'`, `upstreamOrderId:null`, `traceId` | Never pretend sent to Valio |
| `AuditEvent` | `id`, `timestamp`, `traceId`, `actorType`, `actorId`, `action`, `result`, `explanation` | Explain mock decisions without fake cryptographic claims |

Exact enums: `PolicyOutcome = ALLOW | REQUIRE_APPROVAL | DENY`; `Verification = PASS | FAIL | UNKNOWN`; `PhysicalMeasureStatus = VERIFIED | CURATED | INFERRED | UNKNOWN`; `StockCertainty = STOCK_VERIFIED | SUPPLIER_UNKNOWN | OUT_OF_STOCK | BLOCKED | NOT_DELIVERABLE`; `ProposalStatus = DRAFT | READY | PENDING_APPROVAL | APPROVED | REJECTED | BLOCKED | EXPIRED | REAPPROVAL_REQUIRED | COMMITTED_SIMULATED | FAILED`; `ApprovalStatus = PENDING | APPROVED | REJECTED | EXPIRED | SUPERSEDED`.

### 4.1 UI consumes view models, not backend-specific ad-hoc objects

Allow a narrow, explicitly named presentation adapter inside `src/client/`:

```ts
// Example of a VIEW MODEL, not an API DTO:
type ProposalCardView = {
  proposalId: string;
  headline: string;
  totalLabel: string | null;
  policyLabel: 'Auto-approved' | 'Approval required' | 'Cannot proceed';
  sourceLabel: 'Demo fixture' | 'Connected backend';
  hasUnknownQuantity: boolean;
};
```

The mapper translates canonical-shaped provisional API data into UI-ready labels. The component does not infer missing prices, total quantities, allergen safety, supplier delivery or permissions.

## 5. The eight predefined scenarios (fixture names are stable)

| Fixture ID | User-visible interaction | Expected outcome | No false claim |
|---|---|---|---|
| `happy-path-auto` | Buyer asks for available lactose-free milk in permitted budget | `proposal.ready`/`ALLOW` -> simulated order | Not an upstream Valio order |
| `human-approval-budget` | Request exceeds agent's delegated budget | `REQUIRE_APPROVAL` -> approval inbox -> demo manager approves -> simulated order | Approval is mock-only, not live security |
| `supplier-stock-shortage` | Some products insufficient for requested quantity/date | show partial or alternative and ask for user decision | Do not convert shortage into success |
| `terminal-unknown` | Terminal logistics returns unknown supplier quantity | `SUPPLIER_UNKNOWN`, visible uncertainty, no guaranteed stock | `999999` is not stock |
| `allergen-blocked` | Mandatory forbidden allergen / unknown safety evidence | `DENY` or request safe alternative | Never mark unverified allergen safe |
| `price-changed` | Revalidation changes gross amount after approval | `REAPPROVAL_REQUIRED` and show changed lines | Old approval cannot be reused |
| `auth-forbidden` | Agent lacks `orders:commit` scope | 403-like mock error and audit entry | UI role cannot grant itself backend scope |
| `vendor-timeout` | Dynamic offer lookup unavailable | Retriable error; request/intent preserved | No invented price/stock |

### 5.1 Scope of free text in mock mode

Fixtures are NOT a real LLM. A deterministic, documented matcher can recognize a handful of demo intents, but must not falsely claim comprehensive free-text support. For nonmatching requests show: **"This is a demo preview. This request is not configured in mock mode yet."** Let user edit text and retry. In connected mode the backend Mastra agent handles arbitrary text.

Example trigger labels are for the mock scenario selector, not privileged commands passed to the live agent:

```ts
const scenarioLabels = {
  'happy-path-auto': 'Order lactose-free milk within budget',
  'human-approval-budget': 'Order above delegated spending limit',
  'supplier-stock-shortage': 'Product shortage',
  'terminal-unknown': 'Unconfirmed supplier inventory',
  'allergen-blocked': 'Forbidden allergen',
  'price-changed': 'Price changes after approval',
  'auth-forbidden': 'Unauthorized external agent action',
  'vendor-timeout': 'Supplier price service unavailable',
} as const;
```

Use scenario selection through a small **"Demo scenarios"** control only when `NEXT_PUBLIC_USE_MOCKS=true`, not a prominent panel in the standard buyer UI. Default should present a normal purchasing prompt.

## 6. Mock lifecycle and state transitions

An in-memory stateful mock is preferable to unrelated static page fixtures. It must make navigation by ID possible in the same browser session. It may reset on refresh; explicitly document that limitation. For refresh-persistent demos, a frontend-only mock store may persist to **sessionStorage** with fixture data ONLY; never persist credentials or non-demo user data. If refresh persistence becomes a requirement, prefer an explicit mock persistence adapter (not production auth/session state).

**Allowed model:**

```text
Buyer submits request
  -> mock agent emits phase events
  -> mock intent READY or clarification needed
  -> mock proposal READY with immutable version/hash
  -> policy fixture chooses:
     ALLOW -> mock order SIMULATED_CONFIRMED
     REQUIRE_APPROVAL -> proposal PENDING_APPROVAL
         -> demo approver APPROVES or REJECTS
         -> when approved and still valid, mock order SIMULATED_CONFIRMED
     DENY -> proposal BLOCKED; no order
  -> audit fixture entries + conversation references
```

**Never auto-commit** a DENY, UNKNOWN hard-safety restriction, a terminal supply uncertainty, or a stale proposal. The test user must not be able to trick the mock into skipping required approval. This is for a credible demo only; real enforcement must reside in backend.

Mock idempotency: repeated calls to `commitOrder` with the same `Idempotency-Key` + identical payload return the same mock order; same key with different payload returns a 409-style mock error. Preserve `proposalHash` in approval fixtures and use `expectedProposalHash` during approval. Edits to an intent create a new revision; a subsequent proposal has a new version/hash and earlier approval is not silently transferred.

**Synthetic numbers:** provide example EUR totals/quantities only as labeled fixture values, e.g. a demo milk item `productId: '463335'` exists in the supplied static catalog, but any displayed price, stock or date from the fixture is **synthetic**, not live Valio API. Do not invent delivery confirmation, deposit charges or unit conversion when evidence is missing.

## 7. Chat transport and SSE event contract

Proposed real endpoint: `POST /api/v1/agent/chat` (request `{ conversationId?, message, clientRequestId }`). It is **NOT implemented in the reviewed repo**. Implement mock event delivery with the **same event names and envelope** as Appendix A:

```ts
type ProvisionalAgentEvent = {
  event:
    | 'status'
    | 'message.delta'
    | 'intent.ready'
    | 'proposal.ready'
    | 'approval.required'
    | 'order.committed'
    | 'done'
    | 'error';
  runId: string;
  traceId: string;
  sequence: number;
  timestamp: string;
  data: Record<string, unknown>;
};
```

Event details mirror the shared Appendix A, not a new protocol:

| Event | `data` shape |
|---|---|
| `status` | `{phase:'understanding'\|'catalog_search'\|'offer_check'\|'comparison'\|'policy_check'\|'approval'\|'commit', message:string}` |
| `message.delta` | `{text:string}` |
| `intent.ready` | `{intent:PurchaseIntent}` |
| `proposal.ready` | `{proposal:PurchaseProposal}` |
| `approval.required` | `{approval:ApprovalRequest}` |
| `order.committed` | `{order:Order}` |
| `done` | `{conversationId:string,intentId?,proposalId?,orderId?}` |
| `error` | `{error:{code:string,message:string}}` |

For the real SSE adapter, parse `event: <name>\ndata: <JSON>\n\n` from a **POST fetch() ReadableStream** and support chunk boundaries, UTF-8, abort, duplicate/out-of-order sequence detection and non-success HTTP responses. Browser `EventSource` is not suitable as the sole implementation for POST chat. Mock mode can use an async iterator or callback delivering the same `ProvisionalAgentEvent` envelope; UI code must not contain a branch per transport. Stream cancellation is **not** proof an order side effect was cancelled. On failure, load the conversation state rather than automatically replaying commit/approval actions.

## 8. Mock roles and permissions (not production authorization)

Use visually labelled **demo identities** only in mock mode:

- `Demo Buyer` — can request a purchase, view own proposals/orders, not approve.
- `Demo Approver` — can see pending approvals and approve/reject.
- `Demo Admin` — can view agent policy/configuration screens.

A small demo identity selector may appear inside the account menu in mock mode. In connected mode it disappears and roles come only from `/api/v1/auth/me` (HttpOnly cookie). This selector is for UI testing and is **not** a security boundary. Do not issue real credentials or persist them in the frontend.

> **Implemented (connected mode):** identity comes from the existing `GET /api/me` (not `/api/v1/auth/me`): username, organization and roles `buyer`/`approver`, mapped to `BUYER`/`APPROVER` in `src/client/viewer.ts`. There is no admin role on the backend: approvers manage AI settings, so admin screens are shown to approvers. The procurement flow still runs on the local simulator in connected mode (`mode: "simulated"`), acting for the signed-in user with their real roles and storing its data per user (`aimo-procurement-demo-v1:<userId>` in sessionStorage).

Show permission-denied UX on forbidden actions; disabled buttons and hidden navigation are helpful but **not a substitute** for server authorization.

## 9. Visual behavior and screen map

Use `docs/DESIGN-SYSTEM.md` for styles and `design/stitch/` for optional layout references. All pages use exactly one AppShell, AppHeader, Sidebar, ThemeToggle, account menu and notification pattern. Only theme color tokens change between light and dark.

| Route | Essential mock state |
|---|---|
| `/buyer` | welcome, compose, execution progress, clarification, empty/error |
| `/buyer/conversations/[id]` | persisted mock transcript and final resource references |
| `/proposals/[id]` | recommended product, alternatives, intent snapshot, policy decision, price/stock provenance |
| `/approvals` | pending/approved/rejected tabs and counts from mock store |
| `/approvals/[id]` | fixed proposal snapshot, reasons and approver actions |
| `/orders` | simulated order list |
| `/orders/[id]` | simulated order detail, audit timeline, no upstream confirmation |
| `/admin/agents` | agents list, demo admin only |
| `/admin/agents/[id]` | agent policy form, demo admin only |
| `/audit` | history; buyer own resources versus mock approver/admin view |
| `/integrations` | honest backend connection status and proposed MCP tools; no false operational promises |

UI behavior rules:

1. One prominent user task per page, progressive disclosure of technical evidence.
2. Do not show an approval action to a buyer role, even in mock mode.
3. No "success" badges before a matching mock state transition occurs.
4. `SUPPLIER_UNKNOWN` displays **Unconfirmed supplier inventory**, not Available.
5. `INFERRED` / `UNKNOWN` physical conversion displays a warning and never silently auto-orders by volume.
6. Mock environment badge visibly says **Demo data · Local simulated orders**.
7. Money formatting: convert integer minor strings to EUR display without authoritative floating-point calculations; retain raw amount in transport.
8. Dates shown in Helsinki local time but timestamps remain ISO in DTOs.

## 10. Integration tracker (update per route)

Create a simple `docs/INTEGRATION-STATUS.md` once the first mock UI is implemented (frontend may draft it but backend must confirm backend status). Suggested statuses:

- `PROPOSED` — contract exists only in docs.
- `MOCKED` — frontend mock adapter/fixture works.
- `CONTRACT_CONFIRMED` — both owners approve Zod and route behavior.
- `BACKEND_READY` — endpoint available and contract-tested by backend.
- `INTEGRATED` — frontend uses HTTP adapter, scenarios work.
- `LIVE_TESTED` — confirmed end-to-end against deployed backend and permitted supplier mocks.

Start tracking these P0 groups: `auth/me`, `agent/chat`, `catalog`, `offers/check`, `purchase-intents`, `proposals`, `approvals`, `orders`, `audit`, `meta`. `GET /api/health` is independently operational and must remain separately listed.

### Integration reconciliation when teammate is reachable

For **each** route or streaming event, compare proposed docs against implemented backend and capture:

| Check | Confirmed? | Notes |
|---|---|---|
| HTTP method and exact path | ☐ | Do not assume `/api/v1/**` is deployed |
| Query/path/body shape | ☐ | Zod schemas + errors |
| Success response DTO and nullability | ☐ | Amounts must remain string-valued |
| Error envelope & HTTP statuses | ☐ | 401/403/409/422/429/502/503 |
| Pagination, filters and sort | ☐ | Cursors and resource visibility |
| Auth mode and cookie/CSRF | ☐ | Browser cookie ≠ external bearer token |
| SSE event names, ordering & completion | ☐ | Structured final resource refs |
| Idempotency and proposal revision semantics | ☐ | Approval hash and replay behavior |
| Order simulator labeling | ☐ | No fake Valio supplier confirmation |
| Ownership, tenant, scope boundaries | ☐ | Enforced on backend |

**Migration steps:** (1) compare discrepancies, (2) agree final `src/shared/contracts` Zod, (3) update frontend adapters/mappers and mock fixtures, (4) run DTO/stream tests, (5) enable connected mode in a test environment, (6) run all demo scenarios, (7) remove temporary provisional validators only after nothing imports them.

## 11. Implementation milestones for Codex

**Milestone F0 (the Codex plan currently awaiting approval):** install from lockfile, baseline checks, design tokens, theme, shared AppShell, 64px header, 248px sidebar, navigation placeholders, Buyer welcome. No business contracts/API invented. This can be approved **now**.

**Milestone F1-mock (next Codex task):** implement the isolated mock adapter and the end-to-end buyer flow using the provisional types documented here. Ensure component code uses the API facade and contracts are ready to reconcile. Add mock scenarios and local state, proposals, approvals, simulated orders and audit timeline in that order. No backend edits.

**Milestone F2-integration (after contact):** jointly freeze actual Zod contracts, connect HTTP/SSE adapter, run contract tests, only then turn mock mode off.

### F1-mock acceptance tests

- Free-text request in a supported demo scenario triggers actual simulated `status` and `proposal.ready` events, not a fake progress timer independent of the scenario.
- Auto-allowed scenario results in one `SIMULATED_CONFIRMED` local order and a trace.
- Budget approval scenario stays pending until a demo approver approves.
- `DENY`, `SUPPLIER_UNKNOWN`, stale price and timeout never show a false confirmed purchase.
- Refresh/navigation uses IDs and preserves the state as designed (or explicitly displays demo-state-reset behavior).
- Theme and shared shell are consistent on all implemented views.
- No changes to `src/server`, `src/app/api`, `src/shared/contracts`, dependency manifests or deployment code.
- `pnpm check` and `pnpm build` pass, or any external install/baseline blocker is reported precisely.

## 12. Known design and business assumptions, awaiting backend confirmation

1. All business paths `/api/v1/**` are proposals; only existing `/api/health` is verified in the reviewed repository snapshot.
2. Backend uses Hono and OpenAPI in the current repo; an Appendix A reference to generic "Next.js Route Handlers" does **not** supersede that. Hono routes remain the source once implemented.
3. Real procurement is limited to the local order simulator; no supplier order-creation endpoint has been supplied.
4. Supplier `Terminal` quantity 999999 means physical stock **unknown**; don't auto-confirm.
5. Product `salesUnit` and `baseUnit` are known but conversions to requested L/KG may be uncertain. A label such as 1 L in a product name is not verified product metadata by itself.
6. `allowedLotSize = 0.01` is frequently present for discrete units; conservative whole-unit behavior is a proposed team safety policy, not a confirmed supplier rule.
7. Mock customer/role/agent data is artificial. Real organization identity and permissions must always come from the backend.
8. Authentication, server policy, unit normalization, price math and stock validation **cannot** be truthfully implemented by frontend mocks; the fake only demonstrates user experience.

**Owner follow-up:** At the first opportunity, send this file and both task specs to the backend developer, ask them to confirm Appendix A and identify deviations. Do not merge independent incompatible `src/shared/contracts` definitions.
