# Frontend mock strategy v3.2

The active facade is `src/client/api-client.ts`; the active controller and adapters are in `src/client/workspace/`. See its [integration handoff](../src/client/workspace/README.md).

`NEXT_PUBLIC_USE_MOCKS=true` selects the isolated deterministic adapter for all supported domains. It validates canonical-shaped fixtures against existing shared schemas without changing those schemas. Fixture business records live only in sessionStorage `aimo:v32:records`. Browser-local presentation uses a separate versioned, owner-scoped key. Buyer/Approver capability switches and quote failure controls live inside Account > Development tools. They are UI simulations, not authentication or authorization; fixture hashes are consistency tokens, not cryptographic guarantees. No supplier availability, order dispatch or payment is real in this mode.

Unset/false selects actual same-origin HTTP and Better Auth. Existing APIs are always used for identity, catalog, offers, policy, proposals, approvals, orders, preferences, members, recipes and inventory. Errors never enable the fixture adapter. Connected presentation stores transcript, drafts, local plans, activity, server references and idempotency keys, never authoritative copies of orders, proposals or quoted prices.

Only unsupported domains stay local in connected mode: conversation presentation/orchestration, recipe edit drafts, restock plans/manual runs and observed activity. These limitations appear at relevant decisions. There is no cross-tab synchronization, unattended scheduler, global audit persistence or fabricated SSE stream. Refresh stops interrupted presentation work and reloads canonical purchasing records; it never automatically purchases.

Legacy Task 2 `src/client/provisional/` and `src/features/procurement/` remain for historical regression coverage and unmounted components. Active v3.2 routes do not call that workflow. Its unavailable connected adapter remains necessary for those imports; do not delete it as supposedly unused. Historical `/api/v1` proposals in that archive are not current API assumptions.

## Run locally (PowerShell)

```powershell
$env:NEXT_PUBLIC_USE_MOCKS = 'true'
pnpm dev:app
```

Open `/buyer`. This starts the frontend without Docker. For connected mode use false/unset with the backend environment configured by its owner; `pnpm dev` starts Postgres and therefore needs Docker. Never expose secrets through a NEXT_PUBLIC variable. Changing public mode requires restarting development or rebuilding production.

Run `pnpm check`, `pnpm test`, `pnpm build`. Optional externally installed Playwright can run `src/features/workspace/v32.browser.test.mjs` against a fixture build, and `connected.browser.test.mjs` against a connected build. No Playwright dependency was added to the repository.
