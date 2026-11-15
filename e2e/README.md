# End-to-end scenarios

These scenarios drive the **running app over HTTP**, the way a browser, a client or an outside agent would. They go from sign-up through members, preferences, the catalog, proposals, approvals and orders to receipts, verification and the audit log. Every response is parsed with the shared contracts in `src/shared/contracts`, so a scenario also fails when the API drifts from them.

## Run locally

```bash
pnpm dev                 # Postgres + migrations + app on http://localhost:3000
pnpm data:import         # initially and after catalog parser/schema changes
pnpm test:e2e            # in a second terminal
```

- **Agent:** scenario 08 needs `TEST_MODE=TRUE` in `.env` (deterministic) or a Gemini key. Without either, it is skipped.
- **Database:** `DATABASE_URL` (read from `.env`) lets scenario 07 force an approval past its expiry, and lets every file delete the users and organizations it created. Without it, 07 is skipped and test users stay behind. They are easy to spot: every name starts with `e2e_`.
- **Server address:** set `E2E_BASE_URL` to test another server (default `http://localhost:3000`). Against a remote server, leave `DATABASE_URL` unset, or it points at your local database.
- **One scenario:** `node --conditions=react-server --import ./src/server/__tests__/register-paths.ts --test e2e/04-approval-flow.test.ts`.

## In CI

The `e2e` job in `.github/workflows/ci.yml` runs on every pull request and before every deploy. It does the following:

1. Starts Postgres.
2. Fetches the Valio catalog once with the `VALIO_API_URL` and `VALIO_API_KEY` **repository secrets**, then caches it (key `valio-data-v1`).
3. Runs migrations and the import.
4. Builds the app and starts it like the Docker image does: standalone, `TEST_MODE=TRUE`, mock Valio prices.
5. Runs `pnpm test:e2e`.

Without the secrets, the job is skipped with a notice. If the job fails, its last step prints the server log.

**Rate limits.** In production mode (as in CI or on a deployed server), Better Auth allows 3 sign-ins or sign-ups per 10 s per IP. When the client gets a `429`, it waits for the `X-Retry-After` time and retries. That adds about a minute to a full run. The server's limit stays as it is.

## Scenarios

| File | Covers |
| --- | --- |
| `01-auth-organization` | Public routes vs default-deny (401); sign-up = buyer + approver of a new organization; the approver creates a buyer-only and an approver-only member; role checks (403); duplicate usernames (409); the last approver can't be removed (409); another organization sees nothing |
| `02-preferences` | Safe defaults; only approvers edit layers; base → role layer → effective, with sources; locks (409); invalid combinations (422); unknown settings (400) |
| `03-catalog` | Search filters (dietary, origin, allergens, sort); details; `snapshotId` on offers; `/api/catalog` gone; ranking 1000 L in sales units; substitutes |
| `04-approval-flow` | **Core:** proposal (priced, signed, snapshot ids) → no order before approval → send (creator only) → badge count → wrong hash 409 → approve → order → idempotent replay → key reuse 409 → receipt → `/verify` → offline signature check → audit trail in order |
| `05-reject-cancel-revise` | Reject needs a comment; rejected can't be ordered; only the creator cancels (the approval is withdrawn); revise = new proposal, old cancelled, audited |
| `06-policy-outcomes` | ALLOW within limits orders directly; policy preview; DENY above the max (BLOCKED); excluded allergen denies; a substitute needs approval unless allowed |
| `07-approval-expiry` | An overdue approval becomes EXPIRED (badge 0, 409 `APPROVAL_EXPIRED`, no order or cancel) and the system audits it |
| `08-agent` | from-prompt: 1000 L becomes whole cases of a real milk (no chocolate), same rules; `agent/run` acts as the buyer; approvers can't run it |
| `09-recipes-inventory` | Recipe and kitchen stock → from-recipe proposes only what stock doesn't cover; recipes are per organization; stock-out alerts |

## Writing a scenario

- Start from `lib/fixtures.ts`:
  - `newOrg()` gives an owner (buyer + approver), a buyer-only and an approver-only member, each with their own session.
  - `orderableProducts()` picks products with a price that can be delivered by the date.
  - `setLayer()` sets preferences.
- Check responses with `ok(reply, status, Schema, "what")`. It asserts the status and parses the body with the contract. For errors, use `expectError(reply, status, code, "what")`.
- Each file builds its own organizations and ends with `after(() => cleanup(RUN))`.
- Import only from `src/shared/contracts` (schemas and types), never from `src/server`: the suite tests the API from the outside.
