import { chatRequestSchema } from "@/lib/chat-schema";
import { agentFetch } from "@/server/agent";
import { toAgentChatBody } from "@/server/chat-body";

// Validates the browser's request, builds the agent body server-side, and streams
// the agent's AI SDK UI message stream back.
export async function POST(request: Request) {
  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid chat request." }, { status: 400 });
  }

  const upstream = await agentFetch("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toAgentChatBody(parsed.data)),
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    console.error(`agent /chat failed with ${upstream.status}`);
    return Response.json({ error: "The agent server is unavailable." }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
