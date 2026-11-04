import { latestRunStatuses, type ThreadRunStatus } from "@copilot/db";
import { connection } from "next/server";
import { appDb } from "@/server/db";

export type RunStatusResponse = { runs: Record<string, ThreadRunStatus>; now: number };

// Sidebar markers: each chat's latest run, plus the server clock so "seen" times compare
// against endedAt on one clock (the browser may be a phone via ngrok).
export async function GET() {
  await connection();
  const body: RunStatusResponse = { runs: await latestRunStatuses(await appDb()), now: Date.now() };
  return Response.json(body);
}
