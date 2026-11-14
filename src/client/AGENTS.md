# Frontend zone (API client)

**Owner:** Frontend dev.

Frontend zone. The only connection to the backend. Do not touch `server/`.

- `api-client.ts`: our `/api` endpoints. Every method is typed by `shared/contracts` and returns data from `mocks/` when `NEXT_PUBLIC_USE_MOCKS=true`.
- `auth-client.ts`: Better Auth client (`signIn`, `signUp`, `signOut`, `useSession`). Login + password only; it fills Better Auth's required email/name itself.

See the root AGENTS.md for ownership and the boundary rules.
