# Backend audit (2026-11-15)

This is a check of the backend on `main` after PR #19. It covers:
- automated checks;
- a review of the code added since #16;
- an edge-case probe that recorded about 45 requests and responses against a dev server with the real catalog (`TEST_MODE=TRUE`).

The probe script is `audit-edges.mjs`. Its recordings are `audit-edges.json` and `audit-edges-valio-down.json`.

**Verdicts:**
- **OK:** behaves as intended.
- **Bug:** fix planned on `fix/backend-audit`.
- **By design:** intended; the reason is noted.
- **Pending:** not verified yet.

## Automated checks
- `pnpm check` is clean.
- `pnpm test`: 86 server and 67 client tests pass.
- CI e2e suite: green on `main`.

## How the backend uses the Valio API
- Valio offers **no product search**, only `POST /api/price`, `POST /api/availability` and the static file downloads. So:
  - What buyers can find is the **imported catalog** (`valio_product`, 17,546 products).
  - Live calls only add price and stock, at most 50 ids per offers request and 1,000 per Valio call. Answers are cached for 5 minutes and stored as snapshots.
- **A product that isn't in our database is never sent to Valio.** `knownProducts()` drops it and reports it as `unknownProductIds`, or `UNKNOWN_PRODUCT` in the policy. New Valio products appear only after a re-import (see "Catalog (manual)" in `deploy/README.md`).
- **Without `VALIO_API_KEY`** the client runs in mock mode, with deterministic fake prices and `source: "mock"`.

## Findings

### Catalog and Valio
| Case | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| Unknown product id: details, offers, rank, policy, proposal | 404, listed as unknown, DENY `UNKNOWN_PRODUCT`, BLOCKED | Same | OK |
| Product not orderable on the date | DENY | DENY | OK |
| Unknown stock (Valio placeholder) | No availability rule | None | OK |
| More than 50 ids in `/offers` | 400 | 400 | OK |
| Product without a Valio price; deliverable only after the date | DENY `PRICE_UNKNOWN`; approval `LATE_DELIVERY` | Not in the sample (all 100 probed products were priced and on time); covered by unit tests | OK (unit tests) |
| Valio unreachable: offers, policy, proposals, rank, `from-prompt`, agent | 502 `VALIO_UNAVAILABLE` | After the fixes: all six answer 502, and search (static data) still works | OK (verified) |
| Valio unreachable: `from-prompt`, agent, rank (before the fixes) | 502 | The agent's candidate search swallowed the error, so the buyer was told "No product matched". | **Bug**, fixed (fix 1) |
| Transient Valio errors (429, 5xx, timeout) | One retry | No retry | **Bug** |
| Server in mock mode | Visible | `/api/health` doesn't say it; there is no warning in production | **Bug** |

### Requests and validation
| Case | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| Quantity 0 or negative; invalid date; empty or >4,000-character prompt | 400 | 400 | OK |
| Delivery date in the past | Refused | **Accepted**: a READY proposal for 3 days ago, with only a `LATE_DELIVERY` approval reason | **Bug** |
| 1.5 pieces of a piece product | Refused? | Accepted | By design: Valio's data allows lot size 0.01 for almost every product |
| Quantity 10⁹ | Not a crash | Proposal of €5.36 billion, approval (`INSUFFICIENT_STOCK`) | By design: no default max order value; an approver must decide |
| Unknown unit ("buckets") | Marked unconverted | "taken as 5 ST: unknown unit … Check the quantity" | OK |
| Prompt matching nothing ("unicorn steak") | No proposal, clear message | Same | OK |
| Two items in one prompt | Two lines | Two lines | OK |
| Finnish prompt "2 kg voita" (butter) | Butter | **"No product matched"** | **Bug** (search) |

### Purchasing flow
| Case | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| Approve twice | 409 | 409 | OK |
| Order again with another key | 409 | 409 | OK |
| Another organization reads or orders the proposal | 404 | 404 | OK |
| Order after the quote expired | 409 `QUOTE_EXPIRED` | Same | OK |
| Order after Valio's price changed | 409 `PRICE_CHANGED` | Same | OK |

### Rules (code review)
| Case | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| Nutrition limits (max kcal, fat, sugar, salt; min protein, added after #16) | Applied wherever products are chosen | Only the agent's prompt selection applies them. `/rank` and swaps in `revise` skip them, and the policy check doesn't know them. | **Bug** (`/rank` and `revise`); the policy rule needs a contract change, so it's noted for later |

### Search quality (`GET /api/products?q=…`)
| Query | Result | Verdict |
| --- | --- | --- |
| "cheddar", "gluten free bread", "potatoes" | Relevant first results | OK |
| "100 litres of lactose-free milk" | **0 results**: "100", "litres" and "of" are required words | **Bug** |
| "mlik" (typo) | **0 results** | **Bug** |
| "salmon fillets" | **0 results**: plural "fillets" vs "fillet" | **Bug** |
| "voi" (fi: butter) | First "Viher Voima nettle", then a wine glass ("Savoie"): matches inside other words | **Bug** |
| "maito" (fi: milk) | First a chocolate bar ("Maitosuklaa"): ranked by the English name only | **Bug** |
| "lactose-free milk" | Coffee milks first | **Bug**: relevance ignores product-changing words |
| "100 litres of lactose-free milk" (after the fixes) | First was "Flora Professional **Milk free** margarine" | **Bug**, fixed: "<word> free" now counts as the opposite of the word |

## Fixes (branch `fix/backend-audit`)
| # | Fix | Status |
| --- | --- | --- |
| 1 | Valio errors surface as 502 `VALIO_UNAVAILABLE`. The agent's candidate search rethrows in buying flows (`strict`), and `app.onError` maps any remaining Valio error, including inside the agent. Stock-out alerts and recommendations still degrade quietly. | Done |
| 2 | One retry for transient Valio errors (connection failure, 429, 502–504; `Retry-After` honoured, capped at 5 s). Timeouts and 4xx aren't retried. | Done, unit-tested |
| 3 | `GET /api/health` reports `valio: live \| mock`; a production server without a key logs a warning. | Done |
| 4 | `UNKNOWN_PRODUCT` explains "not in the imported Valio catalog; re-import". | Done |
| 5 | A delivery date before today is refused: 422 `DATE_IN_PAST`. The error handler maps every unhandled purchasing error to its own status and code. | Done |
| 6 | Nutrition limits apply in `/rank`, which loads nutrition for summaries, and in swaps and additions in `revise`. The policy rule needs a contract change, so it's left for later. | Done |
| 7 | Search: query parsing (`server/search/query.ts`): amounts and filler words dropped, dietary words → tag filter, plural stems, Finnish food words → English, typo correction against catalog words (`matchedFuzzy`, `searchedFor`). Short words match at a word start only. Relevance uses names in every language and is reranked with the agent's matcher (moved to `server/search/name-match.ts`). The agent's candidate search uses the same cleaning, so "2 kg voita" finds butter. | Done; unit tests plus e2e in `03` |

**Verified (2026-11-15):** after the fixes, the normal probe passes 39 of 39 cases, twice:
- a past date gives 422 `DATE_IN_PAST`;
- "2 kg voita" gives a butter proposal;
- every search query finds relevant products ("mlik" is corrected to milk);
- all flow edges are correct.

The Valio-down probe passes 8 of 8 (502 everywhere, search still works).

Note: Valio's availability answers for the same product changed between runs minutes apart (e.g. 469556: not orderable, then orderable with unknown stock). The 5-minute cache and the order-time re-check (`AVAILABILITY_CHANGED`) handle that.

How to re-run the probe:
1. Re-run it normally. The search rows and "2 kg voita" should be OK, and "date in the past" should be 422.
2. Re-run it with `MODE=valio-down` (the server started with `VALIO_API_URL=http://127.0.0.1:9`; the script now uses another delivery date, so nothing comes from the price cache). Every row should be 502.
