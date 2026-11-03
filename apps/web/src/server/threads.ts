import "server-only";
import { COPILOT_AGENT_ID } from "@copilot/shared";
import type { UIMessage } from "ai";
import { z } from "zod";
import { agentFetch } from "./agent";

// The agent server scopes every memory call to the local user's resource
// (SimpleAuth mapUserToResourceId), so these calls can't reach foreign threads.

const threadSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  updatedAt: z.coerce.date(),
});

export type ThreadSummary = z.infer<typeof threadSchema>;

const memoryPath = (threadId?: string) =>
  `/api/memory/threads${threadId ? `/${encodeURIComponent(threadId)}` : ""}?agentId=${COPILOT_AGENT_ID}`;

async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what} failed with ${response.status}`);
  return response;
}

export async function listThreads(): Promise<ThreadSummary[]> {
  const response = await agentFetch(
    `${memoryPath()}&orderBy=updatedAt&sortDirection=DESC&perPage=100`,
  );
  const body = await (await expectOk(response, "listing chats")).json();
  return z.object({ threads: z.array(threadSchema) }).parse(body).threads;
}

/** Stored history, or null when the thread doesn't exist (yet) or isn't ours. */
export async function getThreadMessages(threadId: string): Promise<UIMessage[] | null> {
  const response = await agentFetch(`/threads/${encodeURIComponent(threadId)}/ui-messages`);
  if (response.status === 404) return null;
  const body = await (await expectOk(response, "loading chat")).json();
  const parsed = z
    .object({ messages: z.array(z.looseObject({ id: z.string(), role: z.string() })) })
    .parse(body);
  return parsed.messages as unknown as UIMessage[];
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  await expectOk(
    await agentFetch(memoryPath(threadId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }),
    "renaming chat",
  );
}

export async function deleteThread(threadId: string): Promise<void> {
  const response = await agentFetch(memoryPath(threadId), { method: "DELETE" });
  if (response.status !== 404) await expectOk(response, "deleting chat");
}
