import { connection } from "next/server";

export type VersionResponse = { deploymentId: string | null };

// The deploy this server runs (the commit SHA, also `deploymentId` in next.config.ts). Open
// pages compare it with their own `data-dpl-id` to notice a newer deploy (AppUpdateBanner).
export async function GET() {
  await connection();
  const body: VersionResponse = { deploymentId: process.env.SENTRY_RELEASE || null };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
