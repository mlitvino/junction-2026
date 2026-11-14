# Frontend integration status

All procurement DTOs and API assumptions remain **provisional and unconfirmed by the backend owner**. This records frontend evidence only. No backend readiness or live supplier validation is claimed.

| Group                       | Frontend status                   | Current behavior / reconciliation                                                                                                                                           |
| --------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`               | Existing client/contract retained | Existing source implementation; unchanged in Task 2. Not part of the procurement browser tests.                                                                             |
| Session / `auth/me`         | **INTEGRATED** (connected mode)   | `GET /api/me` (existing route, not `/api/v1/auth/me`): real sign-in, username, organization and roles `buyer`/`approver`. Mock mode keeps the Demo Buyer/Approver selector. |
| `meta`                      | MOCKED mode notice                | Label shows mock mode, or connected mode with simulated purchasing data. No server metadata loaded.                                                                         |
| `agent/chat`, conversations | MOCKED                            | Three exact scenario prompts, typed scripted events, local conversation IDs and refresh recovery. Actual POST SSE adapter pending.                                          |
| Catalog / offers            | INTEGRATED in connected mode      | Scenarios use real Valio products, prices and availability (`/api/products/{id}`, `/api/offers`); mock mode keeps synthetic `demo-*` data. No catalog search UI.                                                                           |
| Purchase intents            | MOCKED                            | Prepared requirements, immutable revision-1 snapshots; new request replaces editing.                                                                                        |
| Proposals / policy          | Policy INTEGRATED in connected mode | The decision comes from `POST /api/policy/evaluate` (the organization's buyer preferences). Proposals themselves (version token, alternatives) are still local; mock mode keeps the fixed outcome. Proposal endpoints (`/api/proposals`) exist; the frontend doesn't use them yet. |
| Approvals                   | Backend READY, frontend MOCKED    | `GET /api/approvals`, `POST /api/approvals/{id}/decision` exist (hash-bound, comment to reject). The frontend still uses the local simulator. |
| Commit / orders             | Backend READY, frontend MOCKED    | `POST /api/proposals/{id}/order` (idempotency key), `GET /api/orders`. Orders stay simulated (no Valio ordering API). The frontend still uses the local simulator. |
| Audit                       | MOCKED within workflow            | Human-readable activity attached to proposal/order. Standalone audit page remains a placeholder.                                                                            |
| Agents / integrations       | PROPOSED                          | Administrative pages remain Task 1 placeholders.                                                                                                                            |

**Connected mode is mixed:** identity and roles are real; every procurement group below (chat, catalog/offers, intents, proposals, approvals, orders, audit) still runs on the local simulator, which now acts for the signed-in user with their real roles and stores data per user in the browser tab. A buyer's request is therefore not visible to a different approver in another browser until the procurement backend exists.

No procurement group is `CONTRACT_CONFIRMED`, `BACKEND_READY`, `INTEGRATED` or `LIVE_TESTED` based on this work. See [the frontend handoff](../src/client/provisional/README.md) for DTO deviations, proposed method mappings, events, persistence guarantees, tests and the backend reconciliation checklist.

## Known gaps before switching to the real purchasing API

Recorded so they aren't forgotten; none are fixed yet.

- **Provisional types ≠ real contract** (`src/client/provisional/types.ts` vs `src/shared/contracts/purchasing.ts`). Plan the switch as a mapping, not a find-and-replace:
  - Money: frontend `amountMinor` strings **incl. VAT**; backend euro numbers **excl. VAT** (`totalExclVat`, `unitPriceExclVat`).
  - Statuses: frontend `COMMITTED_SIMULATED` vs backend `ORDERED` (backend: `READY`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `BLOCKED`, `ORDERED`, `CANCELLED`).
  - Approvals: frontend binds to `proposalVersion`; backend binds to `proposalHash` (send it with the decision). Backend proposals are immutable: no versions.
  - Intents: the frontend has an intent object; the backend has none (a proposal is created from lines directly).
- **VAT mismatch, visible today in connected mode.** The policy decides on totals **excl. VAT**; the screens show totals **incl. VAT**. A €250 limit and a €283 total on screen can both be correct, which looks like a bug. Show the excl.-VAT total next to policy reasons, or label which one the limit applies to.
