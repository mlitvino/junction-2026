# Frontend zone (API client)

Frontend zone. `api-client.ts` is the only connection to the backend. Do not touch `server/`.

Every method is typed by `shared/contracts` and returns data from `mocks/` when `NEXT_PUBLIC_USE_MOCKS=true`. See the root CLAUDE.md for the boundary rules.
