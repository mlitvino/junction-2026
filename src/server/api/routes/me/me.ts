import "server-only";

import { MeResponseSchema } from "@/shared/contracts/me";

import { requireSession } from "../../middleware/session";
import { createRouter } from "../../router";
import { getMeRoute } from "./me.docs";

export const meRouter = createRouter();

// Needs the signed-in user (the API is otherwise open). Separate statement: `.use()` returns a
// plain Hono type, so chaining `.openapi()` after it doesn't type-check.
meRouter.use("/me", requireSession);

meRouter.openapi(getMeRoute, (c) => c.json(MeResponseSchema.parse({ user: c.var.user }), 200));
