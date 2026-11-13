import { connection } from "next/server";

import { app } from "@/server/api/app";

// Every /api/* request goes to the Hono app in src/server/api. Define endpoints there, not here.
async function handler(req: Request): Promise<Response> {
  // Opt out of build-time prerendering (cacheComponents is on): API responses must be live.
  await connection();
  return app.fetch(req);
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
};
