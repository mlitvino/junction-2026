# Backend zone (API mount)

**Owner:** Backend/infra dev.

Backend zone. This folder holds only `[[...route]]/route.ts`, which mounts the Hono app from `src/server/api/app.ts`. Don't add route files here: endpoints are `createRoute` modules in `src/server/api/routes/`.

Never import from `components/`, `features/`, `client/`. See the root AGENTS.md for ownership and the boundary rules.
