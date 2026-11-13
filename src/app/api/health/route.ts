import { connection, NextResponse } from "next/server";

import { getHealth } from "@/server/services/health";
import { HealthResponseSchema } from "@/shared/contracts/health";

export async function GET() {
  // Opt out of build-time prerendering (cacheComponents is on): health must be live.
  await connection();
  return NextResponse.json(HealthResponseSchema.parse(getHealth()));
}
