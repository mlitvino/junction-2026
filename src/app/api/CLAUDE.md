# Backend zone (route handlers)

Backend zone. Thin route handlers only: validate with a Zod schema from `shared/contracts`, call a service from `server/services`, return a response that matches the schema. No logic.

Never import from `components/`, `features/`, `client/`. See the root CLAUDE.md for the boundary rules.
