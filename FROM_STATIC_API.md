# What changed in `feat/better-static-api`

This is the backend branch `feat/better-static-api`, compared with `main`. It covers catalog data, search, ranking, unit conversion, trust, approval expiry and agent errors. It is written for the **frontend** and **agentic AI** teammates and their coding agents: what changed, what breaks, and what you can now build on.

The full contract is in `src/shared/contracts/*` and in `/api/openapi.json` (Swagger at `/api/docs`). Zones and rules are in `AGENTS.md`. Change only your own zone. A change to `src/shared/contracts/` needs both developers to agree.

## TL;DR

| | Change | Who acts |
| --- | --- | --- |
| ❗ Breaking | `/api/catalog/products*` and `/api/catalog/substitutions` are gone. Use `GET /api/products` and `POST /api/products/{id}/substitutes` | Agentic AI (frontend never used them) |
| ❗ Breaking | `ProposalStatus` and `ApprovalStatus` gain `EXPIRED` | Frontend: handle the value |
| ❗ Breaking | `allergens` on products now lists only allergens the product **contains**. "May contain" is in the new `mayContainAllergens` | Both |
| ❗ Breaking | Agent errors are 503 `AGENT_NOT_CONFIGURED` and 502 `MODEL_FAILED` instead of 500 | Both |
| ❗ Breaking | Retired tables `procurement_order`, `procurement_audit_event` and `organization_procurement_settings` are dropped (migration 0010) | Nobody used them; don't roll back past `9077a91` |
| New | `POST /api/products/rank`: best / better / good with reasons | Both |
| New | Unit conversion: "1000 L" becomes 200 cases of 5 L, everywhere | Both |
| New | Product data: nutrition, labels, claims, dietary tags, content per sales unit, may-contain allergens | Frontend |
| New | `substituteFor` on proposal lines; policy codes `SUBSTITUTE_NOT_ALLOWED` and `MAY_CONTAIN_EXCLUDED_ALLERGEN` | Both |
| New | Trust: `snapshotId` on every price and stock answer; signed proposals; `GET /api/trust/public-key` | Both |
| New | Approval expiry plus `GET /api/approvals/pending-count` for a badge | Frontend |
| Dev | `pnpm dev` applies migrations on start and while running. Run `pnpm data:import` once after pulling (migration 0007 added columns) | Everyone |

## After pulling

1. `pnpm install`.
2. `pnpm dev`. This starts Postgres and applies migrations 0007–0010; later migrations are applied while it runs.
3. `pnpm data:import` once. This fills the new catalog columns: nutrition, labels, content per unit and allergen qualifiers. Without it, those fields are empty.
4. Agent features need `GOOGLE_GENERATIVE_AI_API_KEY` in your `.env`, **or** `TEST_MODE=TRUE` for the deterministic flow and mock model. Without either, the agent endpoints answer 503.

---

## Catalog and products

### One search: `GET /api/products`

The `/api/catalog/products*` routes and the `Catalog*` contracts in `shared/contracts/catalog.ts` were removed. Everything is `GET /api/products`, which reads static data only and makes no Valio calls. All filters are optional:

| Query | Meaning |
| --- | --- |
| `q`, `category` | Words (punctuation-insensitive: "lactose-free" matches "lactose free") and category code |
| `excludeAllergens` | Comma list of names or GS1 codes (`milk,soy` or `AM,AY`) |
| `excludeMayContain` | `true` also drops products that *may contain* those allergens |
| `dietary` | Comma list of tags all required: `lactose-free`, `gluten-free`, `vegan`, `vegetarian` |
| `origin` | Comma list of ISO alpha-2 countries (`fi,se`) |
| `maxCo2PerKg`, `minReliability` | Products with unknown values are kept |
| `vendor`, `brand` | Substring match |
| `label` | A label id, e.g. `EU_ORGANIC_FARMING` (names in `shared/contracts/labels.ts`) |
| `sort` | `name` (default), `co2` (lowest first), `reliability` (highest first). Price sorting is done by `/rank` |
| `limit`, `offset` | Paging (limit up to 100) |

### New fields on `ProductSummary`

Every summary has these fields: search items, rank items and details.

- `allergens`: GS1 codes the product **contains**. Before this branch it also included "may contain".
- `allergenNames`, e.g. `["milk"]`.
- `mayContainAllergens`: GS1 codes it may contain (cross-contamination).
- `dietaryTags`, e.g. `["lactose-free"]`.
- `labels`, e.g. `[{ id: "GOODS_FROM_FINLAND_BLUE_SWAN", name: "Hyvää Suomesta (Blue Swan)" }]`. Storage-temperature entries are filtered out.
- `contentPerSalesUnit`, e.g. `{ value: 5, unit: "L" }` (one case = 5 L), or `null` when unknown.

`ProductDetail` (`GET /api/products/{id}`) adds:

- `nutrition` per 100 g/ml: `energyKcal`, `fat`, `saturatedFat`, `carbohydrate`, `sugars`, `protein`, `salt`, `fibre`, or `null`.
- `claims`, e.g. `FREE_FROM_LACTOSE`, `VEGAN`.

All of this comes from the real Valio data (`products.json`). Synthetic `SYN-` products exist only when the real catalog is empty.

### Ranking: `POST /api/products/rank`

Request:

```json
{ "q": "lactose-free milk", "quantity": 1000, "unit": "L", "date": "2026-11-20" }
```

Instead of `q`, you can send `productIds` (up to 20). `unit` accepts L, dl, ml, kg, g, cases, pcs or a product unit code; leave it out to count in sales units.

Response:

- `best`, `better`, `good`, then `ranked` (all orderable candidates), `unavailable` (with `reason`) and `excluded` (with the organization rules that removed them).
- Each ranked item has `quantity` (in that product's sales units), `salesUnit`, `conversion { converted, note }`, `unitPriceExclVat`, `lineTotalExclVat`, `pricePerContent` (€/L or €/kg), `availableDate`, `availableQuantity`, `priceSnapshotId`, `availabilitySnapshotId`, `score` and `reasons` (e.g. "€1.60/L, cheapest", "preferred origin (FI)").
- Weights: price per L/kg 35%, availability by the date 25%, and 10% each for relevance (name match, ordered before), reliability, CO2 and preferences (preferred origin, vendor or brand, sustainability labels).
- A product that can't take the requested unit (e.g. litres asked, product sold by the piece) doesn't compete when others can.

### Unit conversion

`server/valio/units.ts` (`toSalesUnits`) converts any request into the product's sales unit through the declared content. For example, 1000 L of milk sold in cases of 5 × 1 L is 200 cases, not 1000. When the catalog has no content for a product, the amount is taken as sales units and the proposal carries a warning.

### Substitutes

`POST /api/products/{id}/substitutes` takes the same body as before, except that `productId` is now in the path.

---

## Purchasing, policy, trust

### Substitutes and allergens in the policy

- **`substituteFor`:** proposal lines and `POST /api/proposals` lines can carry `substituteFor: { requested, reason: "split" | "swap" | "fallback" }`:
  - `split`: part of a short-stock split.
  - `swap`: replaced in a revision.
  - `fallback`: the best match couldn't be delivered.

  It is `null` when the line is what was asked for.
- **`SUBSTITUTE_NOT_ALLOWED`:** a substitute line while `allowSubstitutes = false` gives REQUIRE_APPROVAL. That is the default.
- **`MAY_CONTAIN_EXCLUDED_ALLERGEN`:** a product that *may contain* an excluded allergen gives REQUIRE_APPROVAL. *Contains* is still DENY.

### Snapshot ids (where each number came from)

- `PriceQuote.snapshotId` and `Availability.snapshotId` (so also on offers) name the stored Valio answer behind the figure.
- Policy lines, ranked products and proposal lines carry `priceSnapshotId` and `availabilitySnapshotId`. On proposal lines both are optional and absent on older proposals; on proposals they are inside the `hash`.
- `GET /api/proposals/{id}/verify` checks each frozen price against the exact snapshot it names. Each line has `priceSnapshotId`, `availabilitySnapshotId` and `snapshotFound`.

### Signed proposals

- Each new proposal has `signature` (Ed25519, base64url) and `signatureKeyId`. Both are `null` on older proposals. Receipts carry `proposalSignature` and `signatureKeyId`.
- What is signed is UTF-8 `trusted-trade/proposal/v1\n<id>\n<hash>`.
- `GET /api/trust/public-key` (**public**, no session) returns `{ algorithm, keyId, publicKeyPem, publicKeyJwk, message, signatureEncoding }`. Anyone can verify offline. In Node:
  ```js
  verify(null, Buffer.from(`trusted-trade/proposal/v1\n${p.id}\n${p.hash}`), createPublicKey(pem), Buffer.from(p.signature, "base64url"))
  ```
- `/verify` also returns `signatureValid` (`null` when unsigned) and `signatureKeyId`.

### Approval expiry and badge

- An approval has `expiresAt`, equal to the proposal's `quoteExpiresAt` (24 h after creation).
- If nobody decides in time, the approval **and** its proposal become `EXPIRED`. This is final: the buyer creates a new proposal. It is written to the audit log as `approval.expired` with actor "System". Expiry is applied lazily whenever proposals or approvals are read; there is no background job.
- Deciding an expired approval gives 409 `APPROVAL_EXPIRED`.
- `GET /api/approvals/pending-count` (approvers only) returns `{ count, nextExpiresAt }` for a badge. Expired approvals aren't counted.

### Agent selection (`/proposals/from-prompt`, `/from-recipe`, the agent)

- Candidates are matched by name first (every word, trigram similarity), then by product type. A relevance gate drops weak matches (e.g. no chocolate for "milk").
- Each candidate's quantity is converted to its unit and the candidates are ranked with the same scorer as `/rank`.
- New trace fields in `selection.pipeline[]`: `orderedQuantity` and `conversionNote` (e.g. `"1000 L → 200 KI (5 L each)"`). Candidates have `rankScore` and `rankReasons`.
- Warnings appear only for amounts that couldn't be converted.

---

## Agent errors

| Status | `code` | When |
| --- | --- | --- |
| 503 | `AGENT_NOT_CONFIGURED` | No `GOOGLE_GENERATIVE_AI_API_KEY` and not `TEST_MODE=TRUE` |
| 502 | `MODEL_FAILED` | The model call failed or returned output that doesn't parse. The message is generic; details go to the server log. Retry |

Body: `{ error, code }`, defined as `AgentErrorResponseSchema` in `shared/contracts/errors.ts`.

These answers come from `POST /api/agent/run`, `/api/extract`, `/api/proposals/from-prompt` and `/api/proposals/{id}/revise` (when given a `prompt`). `/from-prompt` and `/revise` can also answer 502 when Valio fails; that body has no `code`. A purchasing error raised by a tool during an agent run keeps its own status (400/403/404/409).

---

## For the frontend (`src/app`, `src/features`, `src/components`, `src/client`)

Nothing you call today breaks. `getProduct`, `getOffers` and `evaluatePolicy` only gained fields, and the client tests pass. To do, roughly in priority order:

1. **Statuses:** add `EXPIRED` wherever proposal or approval statuses are rendered or filtered. Handle error code `APPROVAL_EXPIRED` as "expired, create a new proposal", like `QUOTE_EXPIRED`.
2. **Approvals badge:** poll `GET /api/approvals/pending-count` for approvers. Show `count`, and `nextExpiresAt` as "expires in …". Show `approval.expiresAt` on each approval.
3. **Product picker:** use the `GET /api/products` filters (allergens incl. `excludeMayContain`, dietary, origin, label, sort) and `POST /api/products/rank` (best / better / good with `reasons`, `pricePerContent`, the converted `quantity` and `conversion.note`).
4. **Product card and detail:** show `contentPerSalesUnit` ("5 L per case"), `labels[].name`, allergens split into *contains* (`allergenNames`) and *may contain* (`mayContainAllergens`), `dietaryTags`, and on detail `nutrition` and `claims`.
5. **Proposal view:**
   - Mark substitute lines (`substituteFor.reason`).
   - Show the new policy reasons.
   - Show `selection.pipeline[].conversionNote` and the candidates' `rankReasons`.
   - Show a "verified" mark from `GET /api/proposals/{id}/verify` (`hashValid`, `signatureValid`, `lines[].snapshotFound`).
6. **Agent UI:** on 503 `AGENT_NOT_CONFIGURED`, show "Agent unavailable (server not configured)" rather than a crash. On 502 `MODEL_FAILED`, show "Try again".
7. **Mocks:** if mock mode (`NEXT_PUBLIC_USE_MOCKS=true`) needs these endpoints, add mocks in `src/client/mocks/` typed by the contracts. That covers `pending-count`, `rank`, the new product fields and the `EXPIRED` status. Connected-only methods still throw in mock mode (rule 6 in `AGENTS.md`).

`CHECKLIST.md` → "Frontend" lists these items too.

## For the agentic AI part (`src/server/agents`, `services/selection.ts`, `services/extract.ts`)

- **Tools:**
  - `searchProducts` (`agents/tools/search-products.ts`) calls `searchProducts()` from `services/catalog.ts` and accepts the new filters.
  - New `rankProducts` tool (id `rank-products`) wraps the ranking service; use it to compare options before `createProposal`.
  - `getProductDetails` calls `getProduct()` and returns nutrition, claims, labels and content.
  - The purchasing agent's instructions already mention `rankProducts`.
- **Removed:** `searchCatalogProducts`, `getCatalogProductDetail` and the helpers around them in `services/inquiry.ts`; `server/valio/types.ts` (import from `@/shared/contracts/products`); the `/api/catalog/*` routes. Use `services/catalog.ts` (`searchProducts`, `getProduct`, `getUnitFacts`, `getProductSummaries`, `getPrices`, `getAvailability`, `getOffers`).
- **Selection:** `services/selection.ts` (`getCandidatesByProductType`, the selection loop and `rankProducts`) uses name-first search, the relevance gate, `toSalesUnits` and `rankCandidates` (`server/purchasing/ranking.ts`, pure, with tests). It sets `substituteFor` for split, swap and fallback lines. Keep the ranking weights in one place, `RANK_WEIGHTS`.
- **Model calls:** wrap every model call **and the parsing of its output** in `callModel()` from `agents/mode.ts`. Call `requireGeminiApiKey()` before using Gemini. Don't throw a plain `Error` for configuration problems; throw `AgentError`, so the API answers 503 or 502 instead of 500. In the agent run, `PurchasingError` passes through `callModel` on purpose.
- **Test mode:** `TEST_MODE=TRUE` uses the deterministic flow and mock model. CI and `pnpm test:server` depend on it.
- **Known gap:** the relevance gate can't tell "lactose-free milk chocolate" from milk when the request has no unit. A category-based filter would fix it; this is a possible next step.

## Database and deploy

- New migrations:
  - `0007` catalog columns. Run `pnpm data:import`.
  - `0008` proposal signature columns.
  - `0009` approval `expires_at` and the `EXPIRED` status checks (widened, not narrowed).
  - `0010` **drops** the three retired procurement tables.
- Production needs `GOOGLE_GENERATIVE_AI_API_KEY` (or `TEST_MODE=TRUE`) in the server's `.env`, and `pnpm data:import` once after the deploy.
- Back up the database before deploying 0010 if the old procurement rows matter. Don't roll back to an image older than `9077a91`.
- The signing key is derived from `BETTER_AUTH_SECRET`. Rotating that secret makes older signatures report `signatureValid: false`, because the key id no longer matches.
