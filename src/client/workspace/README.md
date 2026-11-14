# Workspace v3.2 integration handoff

The active facade is `src/client/api-client.ts`. `createHttpApi` and `createMockApi` share a typed method surface; `createWorkspaceService` owns presentation orchestration. React routes call this facade only. No backend/server imports, Server Actions, extra API server or new dependencies.

## DTOs and source of truth

Existing `src/shared/contracts/{me,products,policy,purchasing,preferences,organization,recipes,inventory,intelligence,extract,health}.ts` are read and reused without modification. Canonical proposals have numeric EUR net money, frozen content/hash, quote expiry, optional approval and order ID. Decisions send the exact reviewed hash. Order attempts persist one idempotency key per proposal; replay uses that same key. Only `/proposals/{id}/order` creates canonical orders.

`model.ts` contains provisional **frontend presentation** schemas only: Thread, RestockPlan, RestockRun, activity, drafts and local version32 state. They are not agreed backend conversation/restocking/audit DTOs. New backend DTOs must be jointly agreed, not copied into shared contracts automatically. Fixture records use canonical-shaped data validated by existing schemas; their hashes and role controls are not security mechanisms.

## Actual paths

See [the tracker](../../../docs/INTEGRATION-STATUS.md) for method-level status. Canonical proposal creation/list/read/cancel/request-approval, approvals list/decision, and purchasing orders list/read are wired. Manual selection uses product search/detail, shortlisted offers and policy preview. Real settings, members, recipes and inventory use their existing routes. Unsupported recipe updates, restock CRUD/scheduler, external keys, MCP, global audit and payment do not invent endpoints.

`POST /api/agent/run` and alternate `/api/orders` mutations/checkout are deliberately excluded: that model can cause side effects and does not share canonical purchasing lifecycle IDs. Connected conversational entry uses `/api/extract` plus explicit user selection; local deterministic responses are presentation assistance, not a real autonomous model conversation.

## Persistence and interrupted work

- Fixture records: sessionStorage `aimo:v32:records`, selected only by `NEXT_PUBLIC_USE_MOCKS=true`.
- Presentation: `aimo:v32:development:presentation` or `aimo:v32:connected:presentation`, additionally validated against organization:user owner.
- Connected storage contains transcript, server IDs, drafts, local plans/runs/activity and stable idempotency keys. No authoritative proposal/order/price copies. Refresh reloads actual server records and marks interrupted presentation stopped; no automatic purchasing replay.
- Same-tab role simulation is fixture-only. Real approvals were tested across two authenticated contexts. There is no fake cross-tab sync, server transcript or unattended plan execution.
- If review submission fails after proposal creation, retain the existing canonical proposal and expose explicit retry. Material changes cancel before marking the old revision superseded. Failed cancellation cannot silently hide a live server proposal.

## Money, quantity and safety

Net totals are labeled excl. VAT; no universal VAT assumption or gross reconstruction. Supplier quantity null stays unknown. Compatible G/KG, ML/L math and published product weight/pack units are allowed; names never establish pack volume. Whole discrete KI/ST/PAK quantities are checked before proposal creation. Mandatory allergen restrictions require positive evidence unavailable in current contract, so those purchases/batches stop for confirmation. Backend must enforce its own safety and unit rules; frontend checks do not provide authorization guarantees.

## Future conversation/SSE agreement

No SSE route is assumed or called today. Agree endpoint, auth, request idempotency/correlation and reconnection before implementation. Suggested semantic events to reconcile, **not current contracts**:

- `status`: preparation stage, no side effects implied.
- `message`: assistant content and explicit source/evidence references.
- `proposal`: canonical immutable proposal ID/hash only; fetch canonical details.
- `approval`: canonical approval/proposal identity/status.
- `order`: canonical order ID after confirmed server result, never inferred from text.
- `error` / `done`: recoverable code, completion and replay/resume boundary.

Material revisions need server cancellation/replacement linkage and stale-hash rejection. Information answers must not create revisions. Reload/reconnect must not re-run ordering tools. Recipe free-from evidence, stock coverage, global audit and scheduler need their own agreed contracts.

## Tests

`pnpm test` includes `workspace.test.mjs` and historical Task2 regressions. Browser harnesses use externally supplied Playwright (no package edits):

```powershell
$env:PLAYWRIGHT_MODULE_PATH = '<existing Playwright module directory>'
$env:FRONTEND_BASE_URL = 'http://localhost:3001'
node --test src/features/workspace/v32.browser.test.mjs
# Against a separately built connected instance with local DB/catalog:
node --test src/features/workspace/connected.browser.test.mjs
```

Run fixture and connected harnesses separately against matching mode builds. Connected harness creates QA accounts/organization and a LOCAL_SIMULATOR canonical order; credentials remain in memory and are never logged. Do not run it against production. Current results and screenshots are recorded in the docs tracker/report.

Legacy `provisional/` remains an archived Task2 regression surface, not the active application's DTO source. Its unavailable adapter is still referenced by legacy components and must not be deleted without their coordinated removal.
