import { approvalsForThread, threadUsage } from "@copilot/db";
import { threadIdSchema } from "@/lib/chat-schema";
import { appDb } from "@/server/db";
import { serverEnv } from "@/server/env";

export type ThreadUsageResponse = Awaited<ReturnType<typeof threadUsage>> & {
  approvals: Awaited<ReturnType<typeof approvalsForThread>>;
  studioUrl: string;
};

// Technical panel data for one chat: runs with events and totals, approvals, Studio base URL.
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/threads/[threadId]/usage">,
) {
  const threadId = threadIdSchema.safeParse((await params).threadId);
  if (!threadId.success) return Response.json({ error: "Invalid chat id." }, { status: 400 });
  const db = await appDb();
  const [usage, approvals] = await Promise.all([
    threadUsage(db, threadId.data),
    approvalsForThread(db, threadId.data),
  ]);
  const body: ThreadUsageResponse = { ...usage, approvals, studioUrl: serverEnv().AGENT_URL };
  return Response.json(body);
}
