import { threadIdSchema } from "@/lib/chat-schema";
import { agentFetch } from "@/server/agent";

// Stop button: closing the stream alone keeps a durable run going, so stop it explicitly.
export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/chat/[threadId]/stop">,
) {
  const threadId = threadIdSchema.safeParse((await params).threadId);
  if (!threadId.success) return Response.json({ stopped: false }, { status: 400 });
  const upstream = await agentFetch(`/chat/${encodeURIComponent(threadId.data)}/stop`, {
    method: "POST",
  });
  return Response.json(await upstream.json().catch(() => ({ stopped: false })), {
    status: upstream.ok ? 200 : upstream.status,
  });
}
