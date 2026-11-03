import { threadIdSchema } from "@/lib/chat-schema";
import { agentFetch } from "@/server/agent";
import { streamHeaders } from "@/server/stream";

// useChat({ resume: true }) calls this on mount: reconnect to the chat's running reply, or 204.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/chat/[threadId]/stream">,
) {
  const threadId = threadIdSchema.safeParse((await params).threadId);
  if (!threadId.success) return new Response(null, { status: 204 });
  const upstream = await agentFetch(`/chat/${encodeURIComponent(threadId.data)}/stream`, {
    signal: request.signal,
  });
  // A chat that doesn't exist yet has nothing to resume.
  if (upstream.status === 204 || upstream.status === 404 || !upstream.body) {
    return new Response(null, { status: 204 });
  }
  return new Response(upstream.body, { status: 200, headers: streamHeaders(upstream) });
}
