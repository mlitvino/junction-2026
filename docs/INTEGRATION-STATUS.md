# Frontend integration status

All procurement DTOs and API assumptions remain **provisional and unconfirmed by the backend owner**. This records frontend evidence only. No backend readiness or live supplier validation is claimed.

| Group                       | Frontend status                   | Current behavior / reconciliation                                                                                                  |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`               | Existing client/contract retained | Existing source implementation; unchanged in Task 2. Not part of the procurement browser tests.                                    |
| Session / `auth/me`         | MOCKED UI role only               | Demo Buyer/Approver selector; not login, cookie auth, organization isolation or real authorization.                                |
| `meta`                      | MOCKED mode notice                | Explicit local fixture notice or integration unavailable; no server metadata loaded.                                               |
| `agent/chat`, conversations | MOCKED                            | Three exact scenario prompts, typed scripted events, local conversation IDs and refresh recovery. Actual POST SSE adapter pending. |
| Catalog / offers            | MOCKED                            | Synthetic `demo-*` products, prices and availability. No catalog search or supplier HTTP request.                                  |
| Purchase intents            | MOCKED                            | Prepared requirements, immutable revision-1 snapshots; new request replaces editing.                                               |
| Proposals / policy          | MOCKED                            | Fixed fixture outcome, version token, recommendation and read-only alternatives. No real policy engine.                            |
| Approvals                   | MOCKED                            | Inbox/detail, explicit send, version-bound approve/reject, shared local state and activity.                                        |
| Commit / orders             | MOCKED                            | One idempotent local order per proposal, persisted list/detail and history; no supplier submission.                                |
| Audit                       | MOCKED within workflow            | Human-readable activity attached to proposal/order. Standalone audit page remains a placeholder.                                   |
| Agents / integrations       | PROPOSED                          | Administrative pages remain Task 1 placeholders.                                                                                   |

No procurement group is `CONTRACT_CONFIRMED`, `BACKEND_READY`, `INTEGRATED` or `LIVE_TESTED` based on this work. See [the frontend handoff](../src/client/provisional/README.md) for DTO deviations, proposed method mappings, events, persistence guarantees, tests and the backend reconciliation checklist.
