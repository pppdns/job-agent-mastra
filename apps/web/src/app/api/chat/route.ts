import { agentFetch } from "@/server/agent";

// Streams the agent's AI SDK UI message stream through to the browser.
export async function POST(request: Request) {
  const upstream = await agentFetch("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
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
