import "server-only";
import { serverEnv } from "./env";

/** Calls the Mastra agent server with the shared secret. The browser never talks to it directly. */
export function agentFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { AGENT_URL, AGENT_SHARED_SECRET } = serverEnv();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${AGENT_SHARED_SECRET}`);
  return fetch(new URL(path, AGENT_URL), { ...init, headers });
}
