import "server-only";

/** Headers for passing an AI SDK UI message stream (SSE) through unchanged. */
export function streamHeaders(upstream: Response): HeadersInit {
  return {
    "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "x-vercel-ai-ui-message-stream": "v1",
  };
}
