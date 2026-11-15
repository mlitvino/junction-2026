# What changed in `feat/better-static-api`

This is the backend branch `feat/better-static-api`, compared with `main`. It covers catalog data, search, ranking, unit conversion, trust, approval expiry and agent errors. It is written for the **frontend** and **agentic AI** teammates and their coding agents: what changed, what breaks, and what you can now build on.

**Typing note for mocks:** the response fields this branch added are **optional** in the contracts: `snapshotId`, `priceSnapshotId` / `availabilitySnapshotId`, `substituteFor`, `expiresAt`, `signature`, `signatureKeyId`, `proposalSignature` and `signatureValid`. Mocks written against the old contract (e.g. `src/client/workspace/mock-api.ts`) therefore still compile. The real server always sends them, and UI code should treat a missing value as "not available". See [Contract changes: fixes to apply on your side](#contract-changes-fixes-to-apply-on-your-side).

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

## Contract changes: fixes to apply on your side

**What happened.** CI type-checks a branch merged with `main`. The frontend's `src/client/workspace/mock-api.ts` builds price quotes, policy decisions, proposal lines and approvals typed by the shared contracts. This branch had added required fields to those types, so the mocks failed `tsc` (`snapshotId`, `priceSnapshotId`, `availabilitySnapshotId`, `substituteFor` and `expiresAt` were missing). The JSON on the wire was never affected.

**What the backend changed.** Those fields, plus a few more a mock might build, are now `.optional()` in the contracts. The server still always sends them:

| Contract (file) | Field | Server sends | Mock value if you add it |
| --- | --- | --- | --- |
| `PriceQuote`, `Availability` (`products.ts`) | `snapshotId` | id of the stored Valio answer | `"mock-<productId>"` |
| `PolicyLine` (`policy.ts`) | `priceSnapshotId`, `availabilitySnapshotId` | ids or `null` | `null` |
| `ProposalLine` (`purchasing.ts`) | `substituteFor` | object or `null` | `null` |
| `ProposalLine` | `priceSnapshotId`, `availabilitySnapshotId` | ids (absent on older proposals) | `null` |
| `Approval` | `expiresAt` | ISO time | the proposal's `quoteExpiresAt` |
| `Proposal` | `signature`, `signatureKeyId` | Ed25519 signature and key id (`null` on older proposals) | `null` |
| `OrderReceipt` | `proposalSignature`, `signatureKeyId` | same | `null` |
| `ProposalVerification` | `signatureValid`, `signatureKeyId`, `lines[].priceSnapshotId`, `lines[].availabilitySnapshotId` | values | `null` |

The rest of this branch's contract changes are still **required** or **breaking**, so check them when you merge.

### Frontend: fixes and checks

1. **`mock-api.ts` (recommended, no longer needed for compiling).** Add the fields above, so mock mode looks like the real server:
   - offers: `price.snapshotId` and `availability.snapshotId`;
   - `evaluatePolicy` lines: `priceSnapshotId: null, availabilitySnapshotId: null`;
   - proposal lines: `substituteFor: null`;
   - approvals: `expiresAt: proposal.quoteExpiresAt`;
   - proposals: `signature: null, signatureKeyId: null`.
2. **Read optional fields safely.** Use `line.substituteFor ?? null`, `approval.expiresAt ?? proposal.quoteExpiresAt`, `quote.snapshotId ?? "—"`. Don't assume they are present.
3. **New enum values.** Exhaustive maps such as `Record<ProposalStatus, …>` or a `switch` with a `never` check now fail to compile until you add the new values:
   - `ProposalStatus` and `ApprovalStatus`: `EXPIRED`;
   - `PolicyReasonCode`: `SUBSTITUTE_NOT_ALLOWED` and `MAY_CONTAIN_EXCLUDED_ALLERGEN`;
   - error `code`s: `APPROVAL_EXPIRED`, `AGENT_NOT_CONFIGURED` and `MODEL_FAILED`.
4. **New product fields have defaults.** On `ProductSummary` these are `allergenNames`, `mayContainAllergens`, `dietaryTags` and `labels` (default `[]`) and `contentPerSalesUnit` (default `null`); `ProductDetail` adds `nutrition` (`null`) and `claims` (`[]`).
   - A mock that runs `ProductDetailSchema.parse(...)` on an old-style fixture (as `src/client/workspace/mock-api.ts` does) gets the defaults filled in, so `workspace.test.mjs` passes.
   - The parsed type keeps them required, so UI code can read them without `??`.
   - A mock that builds the **parsed** type directly (no `parse`) must set them. Better still: set real values in fixtures, so mock mode shows labels and content.

   New response types are fully required: `RankProductsResponse`, `PendingApprovalCount`, `PublicKeyResponse` and `AgentErrorResponse`.
5. **Meaning change.** `allergens` now lists only what the product **contains**. Any warning that relied on `allergens` for "may contain" must also read `mayContainAllergens`.
6. **Removed types.** `CatalogProductDetail`, `CatalogSearchQuery` and `CatalogSearchResponse` (and their schemas) are gone from `shared/contracts/catalog.ts`. Use `ProductDetail`, `ProductSearchQuery` and `ProductSearchResponse` from `products.ts`. `CatalogProductSummary`, `NutritionProfile` and the inquiry schemas are still there.
7. **Error bodies.** 502 and 503 from the agent endpoints carry `code` (`AgentErrorResponseSchema` in `errors.ts`). A 502 for a Valio failure has no `code`.

### Agentic AI: fixes and checks

1. **Imports.**
   - `@/server/valio/types` → `@/shared/contracts/products`.
   - `searchCatalogProducts` / `getCatalogProductDetail` (formerly in `services/inquiry.ts`) → `searchProducts` / `getProduct` in `services/catalog.ts`.
   - `Catalog*Search*` / `CatalogProductDetail` types → `Product*` types.
2. **Optional types.** `quote.snapshotId` and `availability.snapshotId` are now typed `string | undefined`. Write `quote.snapshotId ?? null` where a `string | null` is expected (as `services/policy.ts` and `services/selection.ts` do).
3. **Errors.**
   - Replace any `throw new Error("…GOOGLE_GENERATIVE_AI_API_KEY…")` with `requireGeminiApiKey()`.
   - Wrap every `agent.generate(…)` together with its output parsing in `callModel(…)` (`agents/mode.ts`).
   - Tests that matched the old error message still pass: the message still names the key.
4. **Substitutes.** If your code builds proposal lines, set `substituteFor` for split, swap and fallback lines. Policy then applies `allowSubstitutes`.
5. **Units.** Pass requested amounts through `toSalesUnits` (`server/valio/units.ts`), or use `rankProducts`, which does it. Don't send litres as a number of cases.

### Rule from now on (both sides)

- **New response fields are added as `.optional()`, or with `.default(…)` when there is a natural empty value.** A required field breaks every mock or test that builds or parses the type. `.default` keeps the parsed type required, while `.optional()` makes readers handle `undefined`. Make a field strictly required only once both sides have updated, by agreement (shared zone).
- **Removing or renaming a field or enum value is breaking.** Announce it here and in the PR.
- **Before pushing,** run `git fetch origin && git merge origin/main` locally (or rebase), then `pnpm check && pnpm test`. CI checks the merged result, not the branch alone.

---

## Review of PRs #11–#13: frontend fixes

This is a code review of the workspace changes merged in PRs #11–#13, re-checked after PR #15 (theme, `chat-checkout`, `trade-airlock`). Types and tests pass, so these are behaviour bugs. The backend side of the same review is fixed (see "Backend changes since the review" below).

**Status after PR #15:** items 1–4 are **still open** (PR #15 didn't touch these files), and items 5–6 are new.

| # | Where | Problem | Effect | Suggested fix |
| --- | --- | --- | --- | --- |
| 1 | `src/client/workspace/model.ts`, `getConversationStatus` | Takes `thread.proposals.at(-1)` as the conversation's proposal. | A revision blocked by policy is appended to the thread, but the server keeps the previous proposal live. The conversation list then shows **BLOCKED** while the detail view (`resolveActiveProposal`) shows the still-active READY or PENDING_APPROVAL proposal. | Use `resolveActiveProposal` here too. The revise response now says explicitly whether the old one was replaced: `previousCancelled` (below). |
| 2 | `src/client/workspace/helpers.ts`, `findMatchingRecipe`; **also** `src/client/workspace/service.ts` (the recipe hint match, `r.tags.some(…)`) | Matches when any recipe **tag** appears anywhere in the message. | Tags like "cheese", "potato", "soup", "snack" and "lunch" send ordinary product requests ("buy 20 kg cheese", "10 L cream for the soup") into the recipe flow, and that flow first **cancels the active proposal**. | Match on the recipe name or id only, or require a recipe or dish intent ("recipe", "make", "cook", "for N servings"). Use whole-word matching, and ask before replacing an active proposal. |
| 3 | `src/client/workspace/helpers.ts`, `parseQuantityRevisionCommand` (two places); **also** `src/client/workspace/service.ts` (the "make/change/set … N" quantity match) | `.replace(/,/g, "")` removes every comma. | "set butter to 1,5 kg" becomes **15**, ten times the intended amount. | Treat `,` as a decimal point (`replace(",", ".")`), as `parseQtyUnitQuery` and the server extractor do. |
| 4 | Contract values not handled | `APPROVAL_EXPIRED` (409 when deciding an expired approval) is not handled anywhere. `mayContainAllergens` is never shown. | An expired approval shows a generic error. "May contain" warnings are invisible to buyers. | Map `APPROVAL_EXPIRED` to "This approval expired with the prices. Ask the buyer for a new proposal." Show `mayContainAllergens` next to `allergenNames` on product cards and in the picker. |
| 5 | `src/features/workspace/chat-checkout.tsx`, `canOrder` (new in #15) | For a READY + ALLOW proposal, ordering is offered only if every line has `availableQuantity !== null && availableQuantity >= quantity`. | Unknown stock (`null`) is normal: most Valio products report no stock figure ("stock not reported"), and the server allows ordering them. So **"order directly" practically never appears**, even when the organization's rules allow it. | Trust `decision.outcome === "ALLOW"` (plus not stale, buyer role). The server re-checks prices and availability at order time and answers 409 `PRICE_CHANGED` / `AVAILABILITY_CHANGED` if something changed. Show those errors instead of pre-blocking. |
| 6 | `src/features/workspace/trade-airlock.tsx`, `checks` (new in #15) | Policy codes are grouped into Budget / Allergens / Substitutes / Delivery only. | A DENY or approval from `BLOCKED_VENDOR`, `CO2_TOO_HIGH`, `RELIABILITY_TOO_LOW`, `CATEGORY_BLOCKED`/`CATEGORY_NOT_ALLOWED`, `PRODUCT_BLOCKED`/`PRODUCT_NOT_ALLOWED`, `UNKNOWN_PRODUCT` or `PRICE_UNKNOWN` lands in **no group**, so every check shows as passed while the proposal is blocked. | Add an "Other rules" group for every code not listed, or group by `reason.setting`. The full list is `PolicyReasonCodeSchema` in `shared/contracts/policy.ts`. |

### Backend changes after the backend audit (`docs/BACKEND-AUDIT.md`)

All of these are additive; nothing existing breaks.
- **Search understands how buyers type.** `GET /api/products?q=…`:
  - ignores amounts and filler words ("100 litres of lactose-free milk");
  - turns dietary words into the tag filter;
  - matches plurals ("salmon fillets") and common Finnish food words ("voi", "maitoa");
  - ranks with the agent's matcher, so coffee milk no longer comes first for "milk".
  - **New optional response fields:** when nothing matched as typed, the results are for corrected words, with `matchedFuzzy: true` and `searchedFor: "milk"`. Show "Showing results for milk".
- **New error codes to handle:**
  - `422 DATE_IN_PAST`: a proposal (direct, from a prompt or from a recipe) whose delivery date is before today.
  - `502 VALIO_UNAVAILABLE`: Valio is down. The agent and `from-prompt` now say so, instead of "no product matched". Show "Valio is unavailable, try again".
- **`GET /api/health`** has `valio: "live" | "mock"` (optional). It's worth a small badge in dev and demo builds when it's `mock`.
- **`UNKNOWN_PRODUCT`** now explains that the product isn't in the imported catalog.

### Backend changes after the 100 L milk flow check

These are not breaking changes; some are worth knowing in the UI.
- **Search order:** `GET /api/products` with `q` now sorts by **relevance** (closest name first) unless `sort` is given. The new value `sort=relevance` is optional, and so is the field now. Without `q` the default stays `name`. A picker no longer starts with "10 x Starbucks Latte" for "milk".
- **`POST /api/products/rank`** now ranks the **same candidates as the agent**. For "lactose-free milk" it recommends the same product the agent picks; before, it recommended "coffee milk". Coffee, latte, cappuccino, mocha and flavour words (vanilla, strawberry, …) now count as a different product.
- **More products have `contentPerSalesUnit`.** When Valio declares none, it is read from a name with exactly one amount ("milk drink 1 l"), about 3,400 products more. Multipacks stay unknown. So "1 l" milks now convert ("100 L → 100 ST") instead of being "can't be converted".
- **Audit trail order:** entries written together (the agent's steps plus `proposal.created`) now come back in the order they happened. Timelines can rely on the list order.

### Backend changes since the review (no action needed, but good to know)

- **`ReviseProposalResponse.previousCancelled`** (optional, always sent):
  - `true`: the old proposal was cancelled and replaced.
  - `false`: the revision came back BLOCKED and the old proposal **stays as it was**, so keep showing it as the active one.
- **Agent product matching** is fixed for varieties, longer names and verb forms. "Cheddar" finds "Cheddar cheese", "rapeseed" finds "Rapeseed oil", "lactose-free milk" finds "… milk drink", "skim milk" finds "skimmed milk" and "whipping cream" finds "whipped cream". Different products such as potato salad, cocoa butter or milk chocolate are still kept out.
- **Changes in words** (test mode: `TEST_MODE=TRUE`) now understand any unit word: "set milk to 30 cases", "change quantity of milk to 300 pcs", "set 30 cases of milk", "Change 469330 to 469386 and set 30 cases". They also accept comma lists: "remove milk, butter".
- **A swap after a quantity edit** keeps the edited amount. Before, it went back to the original request.
- **Fewer Valio calls per prompt:** at most 40 products are priced per requested item, and only the ones whose names can match. The UI sees no difference.

---

## For the frontend (`src/app`, `src/features`, `src/components`, `src/client`)

`getProduct`, `getOffers` and `evaluatePolicy` only gained fields. Since the new response fields are optional, existing mocks compile; see [the fixes above](#contract-changes-fixes-to-apply-on-your-side) for the enum and product-field checks. Features to build, roughly in priority order:

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
