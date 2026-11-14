> Archived Task 2 handoff. Active v3.2 routes use [workspace/README.md](../workspace/README.md) and actual canonical HTTP APIs. The instructions and proposed routes below are historical, not current integration assumptions. Use `pnpm dev:app` for frontend-only development.

# Frontend procurement demo — integration handoff

Status: **PROVISIONAL / FRONTEND-ONLY / NOT APPROVED BY BACKEND**.

This milestone implements synthetic purchasing demonstrations. It does not authenticate users, enforce real purchasing policy, verify supplier data or place Valio orders. No backend, shared contract, dependency or infrastructure changes are needed to run it.

## Run locally

In PowerShell, set the public flag for the process, then start Next.js:

```powershell
$env:NEXT_PUBLIC_USE_MOCKS = 'true'
pnpm dev
```

Open `/buyer`, choose one of the three prepared scenarios, then send the request. The approval scenario prepares a proposal first; click **Send for demo approval**, open its approval, switch to **Demo Approver** in the account menu, and approve or reject. Buyer and Approver use the same browser tab and the same local data. No separate login is involved.

Changing a `NEXT_PUBLIC_*` flag requires restarting development or rebuilding production. With the flag unset/false the new procurement methods deliberately report **Integration unavailable**, even if the independent backend has started adding routes: no HTTP adapter is enabled until its contracts are reconciled. Existing `getHealth()` behavior is retained.

## Boundary and provisional model

`api-client.ts` remains the only UI-facing data facade. Its typed `procurement` port selects either the mock service or an explicit unavailable adapter. Components do not import fixtures or call business endpoints directly. `use-procurement.ts` subscribes to the facade using React's existing external-store API; there is no new state-management dependency.

`types.ts` contains local Zod schemas and `Provisional*` types for money, products/offers/evidence, intents, proposals, approvals, orders, activity, conversations/events, scenario metadata and the local snapshot. These are not shared backend contracts. Money uses integer minor-unit strings; quantities use decimal strings. Display formatting never calculates authoritative line totals, VAT or package conversions.

Reconcile these deliberate differences with the backend:

- Offer `source: SYNTHETIC_FRONTEND_FIXTURE` explicitly replaces the canonical supplier-source literal in this demo. `STOCK_VERIFIED` and `PASS` only classify prepared fixture evidence; the UI never presents them as actual supplier verification.
- The snapshot contains normalized entity collections and a local role. It is a frontend projection, not an API response envelope. Actual session identity, organization, permissions and environment metadata are not implemented.
- Approvals additionally retain `proposalVersion` and `note`; order details additionally retain `intentSnapshot`. Confirm their final wire representation and snapshot semantics.
- Scenario IDs, run states (`RUNNING`, `DONE`, `INTERRUPTED`, `FAILED`), persistence metadata and replay records are demo-local. Do not send scenario controls to the real agent endpoint.
- Each request creates a new intent/proposal with revision/version 1. There is no inline editing or alternative selection in this milestone. A revision starts with a new request; no existing approved snapshot is edited.
- `proposalHash` is a readable local version token, **not a cryptographic hash, signature or security guarantee**. The backend must generate and verify its own approval binding.

## Methods and future API assumptions

The facade currently supports `startConversation`, `requestApproval`, `commitOrder`, `decideApproval`, `setDemoRole`, `resetDemo`, and snapshot/subscription lifecycle methods. The mock stream is internally an async generator. Future HTTP query/loading and streaming reducers must populate the same frontend projection using agreed DTOs.

Proposed API mappings remain those in Appendix A: POST `/api/v1/agent/chat`; conversation list/detail; purchase intent/proposal list/detail; POST proposal `/request-approval` and `/commit`; approval list/detail and POST `/approve` or `/reject`; order list/detail and audit. None of these paths was added, probed or verified by this milestone. Snapshot-backed list/detail screens do not imply these endpoints exist.

Before connecting, confirm methods/paths, DTO nullability, product names and packaging evidence, gross/net/charges semantics, roles/tenant access, session cookies and CSRF, error envelopes, cursor pagination, request idempotency, expiry/revalidation, revision handling and server environment metadata. Policy and commitment must stay on the backend.

## Events

The provisional event union models `status`, `message.delta`, `intent.ready`, `proposal.ready`, `approval.required`, `order.committed`, `done`, and `error`, with `runId`, `traceId`, increasing `sequence`, ISO UTC `timestamp`, and typed `data`.

The three scripts emit the applicable `status` phases (`understanding`, `catalog_search`, `offer_check`, `comparison`, `policy_check`, optionally `approval` or `commit`), intent/proposal/message events and a terminal `done`. Autonomous commitment emits `order.committed`. Failure emits terminal `error`. Updates follow emitted events; no component runs a separate fake progress timer.

In the explicit approval scenario, the buyer sends the proposal **after** the agent stream finishes. This local REST-like action updates the shared state and activity history; it does not append events to a stream already terminated by `done`. `approval.required` is modeled for the future backend-initiated approval stream but is not emitted by these scripts. User-driven approval/commit actions likewise reconcile state directly. A real POST-fetch SSE parser is still required; native GET `EventSource` will not suffice.

## Determinism, persistence and limitations

- `happy-path-auto`: 100 L lactose-free milk, synthetic total EUR 155, `ALLOW`, one local order.
- `human-approval-budget`: 400 L, synthetic total EUR 620, `REQUIRE_APPROVAL`; a fictional EUR 250 delegation is explanatory fixture content, not a browser policy engine. Approving records one order; rejecting requires a reason and records none.
- `allergen-blocked`: 100 L oat drink with no milk-allergen proof, `DENY`, uncertain supplier inventory, no order. Alternatives remain unverified and comparison-only.

The delivery date is the fixed demo value **20 November 2026**. Products are invented `demo-*` records. One litre per sales unit is a curated synthetic assumption, not supplier packaging evidence. Prices/totals/outcomes are supplied by fixtures rather than inferred from user text. Only the exact prepared request is supported; edited arbitrary text returns an explicit limitation and is not persisted.

`sessionStorage["aimo-procurement-demo-v1"]` holds versioned fixture-only state for this tab. On initialization, running conversations become `INTERRUPTED`; uncommitted proposals from those runs become `FAILED`. No stream, commit or approval is automatically replayed. An order already durably recorded before refresh is retained and linked. Invalid/unavailable storage produces a visible notice; storage failure falls back to in-memory demonstration only. There is no cross-tab synchronization. Reset invalidates in-flight scripts and clears local demo entities.

Repeated request IDs do not restart completed/interrupted runs. Commit keys replay the same result, conflicting payloads fail, and each proposal can have at most one order. Repeated identical decisions are harmless; a conflicting decision is refused. These are prototype consistency behaviors, **not security or durable server transaction guarantees**.

## Verification

```powershell
pnpm check
pnpm build
pnpm exec node --test src/client/mocks/mock-service.test.mjs
```

The service tests use the existing TypeScript compiler and Node test runner; transpiled test artifacts stay under ignored `node_modules/.cache/`.

The committed browser harness uses an externally supplied Playwright installation and installed Chrome; no dependency was added. Point it at a production build on an unused port:

```powershell
$env:NEXT_PUBLIC_USE_MOCKS = 'true'
pnpm build
pnpm exec next start --port 3001
# In a second terminal:
$env:PLAYWRIGHT_MODULE_PATH = '<absolute path to an installed playwright package>'
$env:FRONTEND_BASE_URL = 'http://localhost:3001'
pnpm exec node --test src/features/procurement/workflow.browser.test.mjs
```

For the unavailable-mode browser check, rebuild/restart with `NEXT_PUBLIC_USE_MOCKS=false`, then set `WORKFLOW_TEST_MODE=unavailable` for the harness. Browser screenshots go to the system temporary directory. This optional harness does not replace actual backend integration tests.
