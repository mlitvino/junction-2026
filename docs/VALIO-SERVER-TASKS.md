# Aimo TrustBridge — SERVER implementation tasks (Claude Code)

**Version:** 1.0 · 13 November 2026  
**Project:** Junction 2026 — Valio Aimo, *Trusted Trade Agents*  
**Owner:** Backend developer using **Claude Code**  
**Partner:** Frontend developer using **Codex**  
**Status:** implementation-ready team contract. All `/api/v1/**` routes below are **ours**; supplier API routes remain distinct.

> **Goal:** Deliver a truly functional, model-independent **Trusted Trade Gateway** and a **Mastra purchasing agent** that can read Valio's synthetic catalog, check the real challenge mock price and availability endpoints, build verifiable proposals, enforce agent delegation and approvals server-side, and commit *local simulated orders* without bypassing permissions. Publish the same application capabilities as a documented REST API and a secure MCP interface for independent external agents.

## 1. Stack, boundaries, shared AI instructions

- **One Next.js App Router application**, TypeScript `strict`, `src/`, `pnpm`, PostgreSQL 17 + pgvector, Mastra inside Next.js; Next.js Route Handlers for all HTTP APIs. Tailwind/shadcn/UI owned by partner. No NestJS, Vite, SQLite, Pages Router, or Server Actions.
- Runtime: Node.js (not Edge) for Mastra, Postgres, and MCP. Use `import 'server-only'` at top of every appropriate `src/server/**` module. `src/app/api/**` contains only thin authorization/validation/routing adapters; all business decisions happen in `src/server/**` services.
- Owner folders: `src/server/**`, `src/app/api/**`, migrations/schema/seeds, Mastra and MCP server, backend tests, `.github/workflows/**`, Dockerfile, compose/Caddy and server environment. Frontend teammate owns `src/app/(dashboard)/**`, `src/components/**`, `src/features/**`, `src/client/**`; do not edit their code unilaterally.
- Agree on `src/shared/contracts/**` Zod schemas and event protocol **before** parallel coding; they are co-owned. The root `AGENTS.md` is the cross-tool source of truth for **Claude Code and Codex**; add a minimal `CLAUDE.md` containing `@AGENTS.md`. Follow team safety configuration in `.claude/settings.json`, while remembering prompts/settings are not actual business-policy enforcement.
- Keep `pnpm check` as lint + typecheck. Include tests and image build as separate gates. Enforce forbidden imports via ESLint; frontend cannot import `src/server`.
- Source of truth: supplied Valio `openapi.json`, `valio_aimo_junction26_product_data_schema.json`, `valio_aimo_junction26_product_data.json`, delivery-reliability CSV, carbon-footprint CSV and user-provided scoring criteria. No hidden Valio order API, no production marketplace access, no supplier-signed offers.

## 2. Architecture and execution boundary

```text
Web buyer / approver / admin (first-party session)      Independent AI client (bearer token)
              | REST / SSE                                       | MCP Streamable HTTP / REST
              +-------------------------------+-------------------+
                                              |
                                      Next.js route adapters
                                              |
                                   Authenticate + authorize
                                              |
                                 Shared application services
   +--------------------+---------------------+--------------------+-------------------+
   | Catalog & Knowledge| Offer & Constraints | Policy + Approval  | Orders + Audit    |
   +--------------------+---------------------+--------------------+-------------------+
                 |                 |                        |                 |
         Postgres + pgvector  Valio mock API       Postgres transaction   SimulatedOrderPort
                 ^
                 |
       Mastra Purchasing Agent (one constrained caller, never privileged shortcut)
```

- Web requests authenticate user sessions; external REST/MCP requests authenticate **agent-scoped bearer tokens**. Derive organization/customer, actor and scopes from validated credentials, not from model-supplied `customerId`.
- One `ApplicationService` implementation for every business capability; REST adapter, MCP tool and Mastra tool all call it with a trusted `RequestContext`. **Never** create a separate 'trusted' internal shortcut for Mastra.
- Gateway controls enforce auth, tenant isolation, budget, categories, allergens, stock uncertainty, required approval, order idempotency, audit and evidence. No frontend, prompt or agent output may override them.
- `SimulatedOrderPort` is a replaceable backend interface. The only initial adapter writes `SIMULATED_CONFIRMED` records locally; no outward supplier order call. Clearly label its behavior in API and frontend metadata.

## 3. Confirmed Valio supplier API — do not invent operations

**Supplier API:** `GET /api/ping`, `POST /api/price`, `POST /api/availability`, `GET /api/products/download`, `GET /api/delivery-reliability/download`, `GET /api/carbon-footprint/download`; header `X-API-Key` server-side only.

**Shared dynamic request shape:**

```json
{ "customer": "123", "requestedDate": "2026-11-16", "products": ["463335", "462921"] }
```

- 1–1,000 product IDs/request; **business rule:** narrow from local catalog first (typical 5–30 candidates), then call live price/availability. Challenge API has undisclosed rate limits. Never continuously retrieve prices/stock for all 17,546 products.
- Customer doesn't affect responses in this challenge, but does in the intended real system. Send the **server-resolved** customer field and cache by tenant+customer+deliveryDate+productIds with bounded TTL; do not cross-leak.
- `availability` returns `timeNow` in Helsinki time, `closingTime`, `salesBlock`, `logisticModel`, and `scheduleLines`. Empty lines → not deliverable. `availableDate` might be later than requested. Check top-level AND line-level `salesBlock`.
- `Terminal` availability uses sentinel `availableAmount=999999`, explicitly **unknown actual supplier stock**. Store `stockCertainty=SUPPLIER_UNKNOWN`; do not treat sentinel as physical evidence or guaranteed delivery.
- Price `error=true` or missing price → unavailable, never zero. Distinguish `catalogPrice` (net+gross), `priceWithTax` (gross and validity), `comparisonPrice` (per kg/litre **not** per sales unit), tax, validity and currency. Use only compatible sales-unit price for order calculation.
- `closingTime` and returned price validity must be rechecked before simulated commit. Interpret all local dates in **Europe/Helsinki**, persist event timestamps UTC. If supplier semantics are ambiguous, fail closed or request manual review.
- Build `ValioMockClient`: schema parse both requests/responses, set timeout, bounded concurrency, 429 handling/Retry-After, backoff+limited retries for idempotent read operations, sanitised logs and correlation IDs, circuit/error UI status, configurable service URL and API key from server env. Never send the vendor key to browser, LLM, user-visible errors or external agents.
- Download static datasets **once per version** (or read supplied local files for seed). Follow redirects if downloading. Static metadata is not equivalent to fresh stock/price.

## 4. Ingest all provided datasets and preserve provenance

Profile confirmed: 17,546 unique products; 17,544 with English name; 4,425 delivery reliability rows; 11,033 carbon rows; 189 products with 250 substitution edges; ~96% have `allowedLotSize=0.01`, including discrete packaging. Do **not** infer '0.01 boxes' is physically shippable merely because numeric schema permits it.

Create import pipeline (idempotent and resumable):
1. Validate product JSON against the supplied schema where feasible; keep original raw JSON and record warnings rather than silently dropping imperfect optional fields.
2. Normalize `productId`, multilingual names, brand, vendor, category code, origin, sales/base units, lot step, temperature, deleted flag; preserve unrecognized category and unit codes as codes.
3. `ProductPackaging`: `units[].unitId`, `sizeInBaseUnits`, GTIN; `synkkaData.unitConversions` physical measures with **packaging-level basis** (base/case/pallet). These are different concepts; avoid mixing them.
4. `ProductClaim`: classification group/name, ID, `unit` status (`CONTAINS`/`MAY_CONTAIN`/`FREE_FROM` etc.), path and provenance; `ProductSubstitution` source/target; `Producer`, `DepositRequirement` as available.
5. Join carbon/reliability CSV **by exact productId**, leave missing values NULL, not zero. For carbon preserve `kg CO2-eq/kg` unit; for delivery reliability preserve 0..1 as historical metric, not guaranteed probability.
6. Build search index: normalized `name_en/fi/sv`, brand, product ID and optionally PostgreSQL FTS/trigram plus pgvector multilingual embeddings. Exact SKU search must remain accurate and independent of LLM; semantic search is a ranking aid, not hard-constraint evidence.
7. Store import manifest `sourceFile`, checksum, count, importedAt, schemaVersion; verify uniqueness/integrity and cover full catalog after import. Do not commit the 84 MB dataset or keys unless redistribution is explicitly permitted; document reproducible local import.

**Reference registry (no complete supplied codebook):** versioned `ReferenceCode {domain, code, displayName, source, verified, version}` for known GS1/Synkka code definitions; unknown stays UNKNOWN. `CuratedPhysicalMeasure` for verified physical litres/grams per **specified packaging level**, with reviewer, evidence link/text and confidence. The `unitConversions` physical `volume` can be in unexpected units (including weight), so only compatible measures qualify. Avoid using a model's verbal inference as proof.

**Allergen policy:** `CONTAINS` and `MAY_CONTAIN` fail forbidden-allergen checks; `FREE_FROM` passes only where explicitly tied to that exact allergen and not contradicted; absent/unknown data remain `UNKNOWN`. Lactose-free does **not** imply milk-protein-free. Hard forbidden-allergen UNKNOWN must not be auto-committed.

**Lot policy:** apply `allowedLotSize` using decimal math; for discrete `KI`, `ST`, `PAK`, etc. require whole sales units for autonomous orders until clarified, including when lot step is `0.01`. For weight `KG` fractional lots may be fine; preserve `requested`, `chosen`, `shortfall`, `overage` and explanation; never silently round under-requested quantity. The client must show this caveat.

## 5. Database model and migrations

Use PostgreSQL 17 (+pgvector extension); ORM choice is an implementation detail but migration must be automated, deterministic and tested. Prefer explicit constraints and transactions for money/permissions rather than trusting ORM defaults. Suggested tables:

| Table | Key fields / invariants |
|---|---|
| `organizations` | `id`, display name, supplier customer reference, createdAt |
| `users` | `id`, organizationId, email unique scoped, passwordHash/demo auth secret, role, isActive |
| `user_sessions` | hashed opaque session token, userId, expiresAt, revokedAt |
| `agents` | `id`, organizationId, displayName, active/revoked, createdBy, lastUsedAt |
| `agent_credentials` | credential ID, hash, agentId, expiry, scopes, revokedAt, lastUsedAt; never store raw token |
| `agent_policies` | agentId, orgId, policyVersion, max gross order minor units, daily cap, allowed/denied category codes, forbidden allergen codes, substitutions, autoCommit, validFrom/To |
| `products` | productId PK, names, brand, category, units, raw JSON, updatedAt, optional embedding |
| `product_packaging` | productId/unitId, sizeInBaseUnits, GTIN, packaging basis |
| `product_claims` | productId, group, code, relation/status, evidence pointer |
| `product_substitutions` | sourceId, substituteId, original mapping/evidence |
| `reference_codes` | domain/code, verified label/source/version |
| `curated_physical_measures` | productId, basis, value/unit, evidence, reviewer/version |
| `delivery_reliability` | productId PK, reliability decimal/null |
| `carbon_footprints` | productId PK, kgCO2eqPerKg decimal/null |
| `purchase_intents` | id, orgId, createdBy actor, original text, immutable revisions/needsClarification |
| `proposals` | id, orgId, intentId + revision, selected lines, subtotal/total, evidence snapshots, hash, status, policyResult, expiry, version |
| `approvals` | id, proposalId, immutable `proposalHash`, status, requestedByAgent, decidedByUser, note, decision time, expiresAt |
| `orders` | id, orgId, proposalId UNIQUE, **SIMULATED_CONFIRMED**, source=`LOCAL_SIMULATOR`, committedAt, items/total snapshot |
| `idempotency_records` | UNIQUE(organizationId, actorId/key scope, key), request hash, response/result resource ID, createdAt |
| `audit_events` | append-only event ID, timestampUTC, orgId, actorType/ID, action, result, reasonCode, traceId, resourceId, redacted metadata |
| `conversations`, `agent_runs`, `agent_messages` | orgId/userId, message text/tool events (sanitized), intent/proposal/order references, status |
| `import_manifests` | source file hash, records, timestamp, schema version |

All access to customer-owned data must filter by `organizationId` server-side. Add uniqueness/check/foreign-key constraints and indexes (org+status, proposalId, traceId, product search). No raw tokens/passwords, no vendor key in DB. Use DB transaction for approval/commit; conditional update or row lock to avoid concurrent double commit.

### Money, units and time invariants

- Money in **minor units as decimal strings in JSON** (`{currency:"EUR",amountMinor:"12000"}`), safely converted to DB numeric/bigint or decimal library; avoid JS floating-point rounding and native `bigint` JSON.
- Quantities as canonical **decimal strings** with explicit unit; use decimal calculations for unit/lot steps. Store requested physical unit separately from supplier sales unit.
- Dates: `YYYY-MM-DD` for requested delivery in Helsinki; audit timestamp RFC3339 UTC; `closingTime` timezone/source preserved.
- `tenantId` and `agentId` belong in trusted request context, not accepting body overrides. Unknown/null are first-class evidence states.

## 6. Domain services and interfaces

Implement services with explicit request/response Zod contracts and tests:

1. **AuthService / ActorContext** — web login/logout/me; secure HttpOnly SameSite cookies, user roles and tenants; hashed/salted passwords, session expiry, session revoke. For write routes, validate Origin and CSRF strategy consistent with same-site cookies. Separate bearer-token verification for external agents; token expiry/revoke, scope and audience/resource association. Seed separate buyer, approver and admin users; never simulate authorization by accepting a claimed role from browser.
2. **CatalogService** — full local search and product details; multilingual names; safe filters/claims and evidence; no Valio price in static index.
3. **UnitAndClaimService** — packaging quantities, three-value safety checks (`PASS/FAIL/UNKNOWN`), category/claim codebook, curated physical measure and proof; no LLM-derived authoritative facts.
4. **OfferService** — shortlist → parallel price and availability lookup → per-item snapshots, `STOCK_VERIFIED|SUPPLIER_UNKNOWN|OUT_OF_STOCK|BLOCKED|NOT_DELIVERABLE`, price validity/cutoff, gross totals with correct sales units; bounded rate/cache.
5. **ProposalService** — filter hard requirements, score price/reliability/sustainability only among eligible options, handle partial/alternative candidates with rationale, build an **immutable proposed cart** and evidence snapshot. Proposal creation triggers policy evaluation.
6. **PolicyEngine** — explicit deny-by-default delegated policy, scope, allowed category, forbidden allergen, spend per order+per day, substitutions, terminal unknown, quote freshness, permissions. Outcomes `ALLOW`, `REQUIRE_APPROVAL`, `DENY` with stable codes, public reasons and policyVersion. Evaluate again at commit.
7. **ApprovalService** — create scoped approval of exact proposal/hash, expire/cancel/approve/reject; only legitimate human approver; separate actor from external requester; audit each transition. On altered quote/substitution, mark `REAPPROVAL_REQUIRED`.
8. **OrderOrchestrator** — apply policy, approve state, re-query critical Valio pricing/availability, validate snapshot (price may have changed), lock proposal, enforce idem key, create one local order; never call nonexistent supplier order endpoint. Distinguish `READY`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `BLOCKED`, `REAPPROVAL_REQUIRED`, `COMMITTED_SIMULATED` at proposal level from `SIMULATED_CONFIRMED` at order level.
9. **AuditService** — append-only structured events for searches, proposed carts, policy decisions, approvals, denied/replayed commits, order writes and MCP agent activity. Sanitize PII, customer secrets and LLM raw chain-of-thought; log explanatory reason codes and source refs.
10. **Conversation/AgentRunService** — persist chat/conversation, idempotent run identity, real progress events, LLM failures without fake success, session isolation.
11. **ReferenceDataService** — import/manually verify dictionaries/physical package size, provenance and audit changes.
12. **IntegrationStatusService** — `Valio mock reachable`, `LLM provider reachable`, dataset loaded and `orderMode=SIMULATED_LOCAL`, without exposing secrets.

## 7. Mastra Agent — constrained tool orchestration

- Use Mastra **inside Next.js** (server-only); provider credentials env-only; configurable model/provider with a deterministic fixture mode for tests. The live model must pass smoke tests before claiming it works. Use Mastra tools with Zod inputs/outputs that invoke the **same trusted services** as REST/MCP, including `RequestContext` and all policy checks.
- Agent system instructions: extract user intent and ambiguities; search local data; check real live offers for narrowed candidates; respect `hard` versus `soft` constraints; present evidence and uncertainty; decide whether proposal should be sent for approval; NEVER invent attributes, prices, physical quantities, stock or order IDs.
- Core agent tools: `searchProducts`, `getProduct`, `checkOffers`, `createIntent`, `createProposal`, `requestApproval`, `commitSimulatedOrder`, `getPurchaseStatus`; server trusts *validated actor context*, not tool-provided tenant IDs.
- Agent may propose and request approval, but **cannot approve**; no tools for raising its own spending limit or registering its own credentials.
- Use structured extraction: `PurchaseIntent` schema; unresolved unit/date or hard restriction produces `needsClarification[]` rather than silent guesses. Dates resolve Europe/Helsinki (including Monday crossing week) with source-local time, not arbitrary UTC.
- Use explicit streaming events over `POST /api/v1/agent/chat`: `status`, `message.delta`, `intent.ready`, `proposal.ready`, `approval.required`, `order.committed`, `done`, `error`. Include `runId`, `traceId`, resources when known, and do not stream secrets. See Appendix A.
- Streaming and side effects: if client disconnects, do not erroneously replay or commit again. Use a run-level idempotency key and database state. A retry starts a new read-only query or attaches to an existing run as designed; it cannot create duplicate orders.
- Treat supplier product descriptions and user text as untrusted **data**, not instructions to disable guardrails. No prompt injection can change system policy. Mask PII in AI prompts when not necessary.
- Current Mastra Next.js guide supports direct server integration with Next.js route handlers. Use a **pinned, tested** SDK version and test streaming + standalone Docker bundle; don't expose a catch-all Mastra admin API publicly by accident. Official guide: https://mastra.ai/integrations/frameworks/next-js .

## 8. Open agent interoperability — REST + MCP (not just internal functions)

- OpenAPI must describe all our REST endpoints, auth, Zod schemas, examples and error codes. Route `GET /api/openapi.json` serves an up-to-date machine-readable contract.
- Implement **MCP Streamable HTTP** at `/api/mcp` with the current compatible official TypeScript SDK version (v2 stable documentation: https://ts.sdk.modelcontextprotocol.io/v2/). Pin protocol/SDK to tested versions; do not copy deprecated HTTP+SSE-only examples. Use stateless JSON-response mode if sufficient and SDK supported, preserving required MCP handshakes/discovery/tools/call.
- MCP tool catalog: `search_products`, `get_product_details`, `check_offers`, `create_purchase_intent`, `create_purchase_proposal`, `request_approval`, `commit_simulated_order`, `get_order_status`, `get_audit_for_order`. All delegates use application services; read-only tools should be marked accordingly where SDK supports annotations; use safe, bounded argument schemas.
- External agent bearer token is validated on **every** HTTP/MCP invocation (including per-tool execution), bound to org/agent, scopes and expiry; verify Origin and accepted hosts, HTTPS, request-size and rate limits. No tool accepts an arbitrary `tenantId` from the agent. `approve`/`reject` and credential/policy mutation are *not* exposed as MCP tools.
- Publish the demo integration story: use a second independent MCP client in `scripts/external-agent-smoke.ts` with a narrowly scoped token. Demonstrate discover-tools → search → check offers → propose → commit under permitted conditions, then deny an over-budget or revoked token. No hard-coded agent secret in repo.
- Distinguish *protocol conformance* from *production OAuth readiness*: if using scoped demo tokens, don't claim full OAuth/OIDC delegated authorization. Production roadmap has OAuth 2.1 with audience/resource-bound tokens and consent.

## 9. Exact REST route architecture and security

The **complete canonical route matrix appears in Appendix A** and must be identical to the client spec. Suggested file organization:

```text
src/app/api/v1/health/route.ts
src/app/api/v1/meta/route.ts
src/app/api/v1/auth/{login,logout,me}/route.ts
src/app/api/v1/catalog/products/route.ts
src/app/api/v1/catalog/products/[productId]/route.ts
src/app/api/v1/offers/check/route.ts
src/app/api/v1/purchase-intents/route.ts
src/app/api/v1/purchase-intents/[intentId]/route.ts
src/app/api/v1/proposals/route.ts
src/app/api/v1/proposals/[proposalId]/route.ts
src/app/api/v1/proposals/[proposalId]/{request-approval,commit}/route.ts
src/app/api/v1/approvals/route.ts
src/app/api/v1/approvals/[approvalId]/route.ts
src/app/api/v1/approvals/[approvalId]/{approve,reject}/route.ts
src/app/api/v1/orders/route.ts
src/app/api/v1/orders/[orderId]/route.ts
src/app/api/v1/audit/route.ts
src/app/api/v1/agent/chat/route.ts
src/app/api/v1/conversations/route.ts
src/app/api/v1/conversations/[conversationId]/route.ts
src/app/api/v1/admin/agents/route.ts
src/app/api/v1/admin/agents/[agentId]/route.ts
src/app/api/v1/admin/agents/[agentId]/{credentials,revoke,policy}/route.ts
src/app/api/v1/integrations/status/route.ts
src/app/api/openapi.json/route.ts
src/app/api/mcp/route.ts
```

All route handlers must: authenticate; get trusted actor context; check role/scope; parse params/query/body via Zod; invoke service; shape response; emit `X-Trace-Id` and structured audited errors; enforce tenant filters before DB access. `GET /health` may be anonymous but must not include keys/environment. Even when an internal Mastra tool calls a service without HTTP, **perform same authorization in service layer**.

### Error contract and response rules

Return e.g. `{ "error": { "code": "INSUFFICIENT_SCOPE", "message": "This agent cannot commit purchases", "details": {} }, "traceId": "..." }`. Codes include `VALIDATION_ERROR`, `AUTH_REQUIRED`, `INSUFFICIENT_SCOPE`, `TENANT_MISMATCH`, `HARD_CONSTRAINT_FAILED`, `MANDATORY_EVIDENCE_UNKNOWN`, `QUANTITY_UNVERIFIED`, `PRICE_UNAVAILABLE`, `STOCK_UNAVAILABLE`, `TERMINAL_STOCK_UNKNOWN`, `DELIVERY_AFTER_DEADLINE`, `BUDGET_EXCEEDED`, `APPROVAL_REQUIRED`, `APPROVAL_REJECTED`, `STALE_APPROVAL`, `OFFER_EXPIRED`, `POLICY_CHANGED`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `SUPPLIER_UNAVAILABLE`.

HTTP 400 syntax, 401 unauthenticated, 403 forbidden, 404 not found **also for cross-tenant lookup**, 409 immutable version/idempotency conflicts, 422 domain validation, 429 throttled, 502/503 upstream/provider unavailable. No 200 for a failed commit, no secret-bearing stack traces.

## 10. State machine, security invariants and transactions

### Purchase intent
`DRAFT → READY → SUPERSEDED` (edits create a new `revision`); unresolved critical fields stay `DRAFT` with `needsClarification`.

### Proposal
`DRAFT → READY → PENDING_APPROVAL → APPROVED → COMMITTED_SIMULATED` or `REJECTED`, `BLOCKED`, `EXPIRED`, `REAPPROVAL_REQUIRED`, `FAILED`. `ALLOW` can go `READY → COMMITTED_SIMULATED` after pre-commit checks. `DENY` cannot transition to commit. Each transition persists immutable events, version and actor.

### Approval
`PENDING → APPROVED | REJECTED | EXPIRED | SUPERSEDED`; approved records tied to `proposalHash`, actor, policyVersion and limits. If price/quantity/date/substitution/material policy changes, invalidate approval or request approval again. Distinct human must sign off when required by policy.

### Order
Only `SIMULATED_CONFIRMED`, `source=LOCAL_SIMULATOR`, `upstreamOrderId=null` in hackathon MVP. Order ID allocated by DB only after durable transaction. Do not claim final delivery or supplier acceptance.

### Commit algorithm (must be linearizable for same proposal)

1. Resolve tenant/actor/scopes; require `orders:commit` or delegated UI authorization; look up/lock proposal by organization.
2. Validate `Idempotency-Key`; same key+same payload returns prior result; same key+different payload → 409.
3. Check proposal hash/revision, current policy grant and approval if needed. Scope/category/allergen hard constraints always checked independently of LLM.
4. Re-fetch **selected candidate** price and availability only; check validity/cutoff, quantities, Terminal uncertainty, budget and deposits. Recompute monetary totals; material changes → mark `REAPPROVAL_REQUIRED`, don't silently place revised order.
5. In a transaction, insert one `orders` row, update proposal state, increment budget usage/ledger, record idempotency and append audit event. Use unique proposal order constraint and version checks.
6. Return order DTO + trace ID and exactly `SIMULATED_CONFIRMED`. On failure, no false success, no double charge in simulated spend ledger.

Actual network checks cannot be held in an open long DB transaction; use short lock/claim or optimistic version after network step, then transactionally verify version before commit. Race testing required.

## 11. Exception paths and uncertainty handling

| Case | Backend response / policy |
|---|---|
| Partial availability | propose split across equivalent acceptable products only if user permits; otherwise mismatch/approval, never invent quantity |
| Source substitutions | use explicit `substitutions` edges; re-evaluate all hard claims/quantities for the alternate |
| Inferred substitute | semantic similarity alone isn't evidence of safe interchange; flag `NEEDS_HUMAN_REVIEW` |
| Allergen contradiction | `DENY` hard conflict even if AI recommends it; UNKNOWN cannot be auto-committed |
| `Terminal=999999` | `SUPPLIER_UNKNOWN`; at least human review, no claim of verified physical stock |
| Availability after deadline | not eligible for hard deadline; optionally propose late alternative clearly labeled |
| Closing time passed | do not promise requested delivery; re-query or request change |
| Physical measurement unknown | `QUANTITY_UNVERIFIED`; require verified conversion or clear/manual selection, never fabricate |
| `allowedLotSize=0.01` for pack | preserve source lot step but auto-purchase whole discrete pack quantities only |
| Price missing/invalid/expired | no usable offer; explain why |
| Deposit price unknown | show separate unknown charge; refuse autonomous spend when total cannot be bounded |
| Vendor 429/timeout | bounded retry only on reads, clear `SUPPLIER_UNAVAILABLE`; no synthetic 'live' price |
| Approval stale | `REAPPROVAL_REQUIRED`; do not commit changed proposal with old approval |
| Prompt injection | seller catalog text untrusted; cannot mutate policy, tenant or tools |

## 12. Observability, audits and demo mode

- Every run/HTTP request has `traceId`, request timestamp, auth actor and organization, source API call IDs (sanitized), product IDs, policy reason codes, proposalHash and outcome. No raw API key, user credential or hidden LLM reasoning in logs.
- Record `audit_events`: `SEARCH_PERFORMED`, `OFFER_CHECKED`, `INTENT_CREATED`, `PROPOSAL_CREATED`, `POLICY_ALLOW`, `POLICY_REQUIRE_APPROVAL`, `POLICY_DENY`, `APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `COMMIT_REVALIDATED`, `SIMULATED_ORDER_COMMITTED`, `COMMIT_BLOCKED`, `AGENT_TOKEN_REVOKED`, and relevant errors.
- Expose `/api/v1/meta` including `orderMode=SIMULATED_LOCAL`, `dataMode=SUPPLIED_STATIC_AND_VALIO_MOCK_DYNAMIC`, build version and capabilities. `/api/v1/integrations/status` returns truth of reachability and timestamps; no passwords/keys.
- Provide two distinct test/data modes: `live-valio-mock` for real on-demand lookup, and **labeled** `deterministic-fixtures` for reproducible fault injection. A P0 judging demo should show a real Valio price/availability call; negative scenarios may use local deterministic overrides with explicit labels.
- Preserve correctness when a browser aborts a stream; audit run outcome and never duplicate orders on retry.

## 13. Authentication and authorization detail

**First-party users:** create seeded buyer, approver and admin users with separate password-authenticated sessions for hackathon demo. Auth cookie HttpOnly+Secure on HTTPS, SameSite, opaque random token stored hashed, expiry and logout revoke. Avoid plain role switching. All mutations protected via Origin/CSRF policy; whitelist own origin. Passwords hashed using modern algorithm supported by deployment. Rate-limit login.

**External purchasing agents:** admin registers agent and policy, obtains a one-time opaque secret; server stores token hash, not raw value. Token includes/binds organization, agent, scopes, expiry and audience context; server checks active agent and current policy on every call, and supports revocation. Admin can rotate credentials. Agent cannot call `/api/v1/approvals/:id/approve` or any admin endpoint, even if it tries with body keys. `GET /api/v1/health` doesn't reveal agent details.

**Roles:** buyer can create/view own tenant's requests and orders; approver can decide eligible requests but cannot impersonate requester; admin can manage policy/credentials. Permit multiple roles only via explicit role membership. `customer` in supplier request is derived from trusted tenant mapping, not user-supplied arbitrary number.

## 14. Testing plan and evidence requirements

**Unit:** Zod validation, decimals, unit conversions/lot constraints, allergen three-state policy, priority of hard versus soft constraints, salesBlock/Terminal/cutoff, price validity, budget (gross) and substitute filtering, idempotency hashing.

**Integration:** imported catalog row/CSV join counts, seeded auth/login/logout, token expiry/revoke, tenant-isolation `404` on cross-org resource, approval separation, simultaneous duplicate commit produces exactly one order, stale snapshot reapproval, supplier timeouts/429, all routes typed according to Appendix A.

**Agent:** real model provider smoke test with tool calls; prompt injection from product description; ambiguous date/quantity clarification; no hallucinated price/stock; track live versus fixture mode; recorded result with no model-secret exposure.

**MCP:** separate client discovers tools and calls them successfully using valid token, invalid scope denied, attempt to approve via MCP fails, account revocation reflected immediately, non-JSON/tool malformed input handled. Test protocol version and headers/Origin.

**E2E:** browser buyer → real catalog → Valio live price/availability → proposal → AUTO or PENDING → human approval → `SIMULATED_CONFIRMED` → audit. Additional failure scenario with partial/late product and stale price.

Run `pnpm check`, `pnpm test`, `pnpm build`, database migrations/seed, and container smoke. Do not report passing unless commands run. Document fixture-based vs live tests separately. Tests for wrong JSON, invalid date, 1001 products input, empty list, rate limiting, terminal quantity sentinel, unknown allergens, duplicate requests and concurrent commits are required.

## 15. Delivery milestones and API handoff to frontend

| Stage | Implementation | Frontend handoff / verification |
|---|---|---|
| B0 | Next scaffold, Postgres, migration setup, auth model; freeze shared Zod DTOs | Agree payloads, error envelope, SSE event types; frontend starts mocks |
| B1 | Import 17,546 products + CSVs, search endpoint and product details | Give actual search response and 2 verified product IDs |
| B2 | Valio `price` / `availability` adapter, offer normalization, uncertainty model | Live `/offers/check` response and failure fixture |
| B3 | Intents, proposal selection, policy evaluation, approval workflow, simulator, audit | First backend-only complete request → simulated order |
| B4 | Mastra chat streaming into Gateway services, stored conversations | SSE live examples for frontend parser |
| B5 | Scoped external agent token + MCP server + independent demo client | End-to-end external agent proof, test scripts |
| B6 | Admin policy management, status endpoints, OpenAPI | Agent admin UI + audit integration |
| B7 | Fault/retry, security tests, HTTPS build, deploy, recorded demos | Joint live three-scenario verification |

**Agree with Codex owner on DTOs first.** Provide synthetic fixture response files under `src/shared/contracts/examples/` or another co-owned path, Zod-valid and sanitized, before implementing the full real services. API errors, HTTP methods, role rules, pagination and source markers must not drift from Appendix A.

## 16. Deployment and development safeguards (from team decision document)

- `pnpm`, Next.js standalone output, `serverExternalPackages` for the installed Mastra packages as needed and verified; deploy Docker image built on GitHub Actions to GHCR, pull/run on Hetzner Docker Compose; Postgres image `pgvector/pgvector:pg17`; Caddy reverse proxy on HTTPS.
- GitHub CI checks lint/typecheck/test/build and image creation; deployment only on passing checks. Deploy immutable SHA-tagged image and keep rollback tag. DB migration backward compatibility matters; rollback of image does not roll back data.
- No public DB ports. Allow only required ingress (22, 80, 443); outbound access required for Valio mock API and LLM provider. Configure DNS/firewall and secure cookies accordingly.
- Never embed `.env` in Docker build layers or logs, never expose Valio vendor key to external clients. Use server-only env for supplier, LLM and Postgres credentials; git-ignore fixtures containing credentials.
- Claude Code controls in `.claude/settings.json`/hooks/sandbox are development defense-in-depth, not authorization. Root `AGENTS.md` governs **both** coding agents, and tests/CI enforce boundaries. Avoid permissive automatic execution of untrusted downloaded code.
- Independent MCP smoke test and Mastra streaming test must run **inside production-like standalone container**, because local dev success is insufficient.

## 17. Backend definition of done

- [ ] Imported full static catalog and both CSVs with audited counts and joins; unknown codes kept explicit.
- [ ] Local catalog search actually narrows candidates before Valio `price` and `availability` calls; `GET /api/v1/integrations/status` reports live connection truthfully.
- [ ] All REST routes in Appendix A exist with typed Zod contracts and proper role/tenant/scope checks; OpenAPI is downloadable.
- [ ] A real independent MCP client completes search → offer → proposal and receives a scoped/denied result when appropriate.
- [ ] Mastra uses **same** policy/order services and can complete a live-prompt end-to-end sequence; no direct privileged bypass.
- [ ] Human approval bound to immutable proposal; `DENY` cannot commit; stale price/quantities invalidate prior approval; only one simulated order per proposal.
- [ ] Correct handling of `Terminal`, quantity ambiguity, forbidden allergens, missing prices, late delivery, salesBlocks, deposit uncertainty and vendor failures.
- [ ] Real login and admin-scoped agent credentials; all sensitive endpoints authenticated, no customer-data leak across tenants.
- [ ] Persistent audit events with source/provenance and user-facing reason codes; no secret leakage.
- [ ] Docker/Hetzner app and Postgres run from clean deploy; build, check and tests pass. Demo labels local orders as **SIMULATED**.

## 18. Questions for Valio organizers (do not block MVP)

1. Does a local **simulated order record** count as the complete request → lookup → order/approval flow while no supplier order API is documented?
2. Will additional order/approval mock endpoints or webshop credentials arrive later?
3. Is MCP required or are documented REST/OpenAPI clients enough for external-agent interoperability?
4. What does `allowedLotSize=0.01` on physical `KI`/`ST` packaging mean: true permitted fractional sales unit or exported system artifact?
5. Is `Terminal` 999999 quantity an invitation for provisional order or should supplier confirmation be mandatory?
6. Can Valio supply category, unit, allergen, claim and lot-size code dictionaries?
7. Which authoritative field should be used for physical content volume/weight for each packaging level?
8. How are deposit charges priced and included in order totals and budget limits?
9. Do availableDate and closingTime semantics allow early delivery, and what timezone is closingTime guaranteed in?
10. Does the reliability metric measure on-time delivery, fulfillment or another outcome; how should it affect automatic decisions?
11. Must an agent's purchase budget be evaluated net, VAT-inclusive gross, or gross including deposits/shipping?
12. Are substitutions requiring manual approval even if exact hard constraints hold, or may tenant policy permit auto-substitution?
13. Are there API request limits or prescribed max concurrency beyond the 1,000 product IDs and undisclosed rate limits?
14. Is signed supplier evidence/Verifiable Credentials valued or is a transparent trace of API reads sufficient for the hackathon?

> **Provenance:** product/price/availability fields are grounded in supplied datasets and supplier OpenAPI; business approvals, orders, permissions, all local routes and MCP tool names are **our proposed app design** pending organizer feedback. Document assumptions in README and judging slides.


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

