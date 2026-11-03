"use server";

import {
  type ApprovalView,
  type DecisionError,
  decideApproval,
  getApprovalView,
} from "@copilot/db";
import { refresh } from "next/cache";
import { z } from "zod";
import { threadIdSchema, threadTitleSchema } from "@/lib/chat-schema";
import { appDb } from "@/server/db";
import { deleteThread, renameThread } from "@/server/threads";

export async function renameChat(threadId: string, title: string): Promise<void> {
  await renameThread(threadIdSchema.parse(threadId), threadTitleSchema.parse(title));
  refresh();
}

export async function deleteChat(threadId: string): Promise<void> {
  await deleteThread(threadIdSchema.parse(threadId));
  refresh();
}

const decisionSchema = z.object({
  approvalId: z.string().min(1).max(64),
  threadId: threadIdSchema,
  decision: z.enum(["approve", "reject"]),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * The user's approve/reject click. App code enforces the rules (chat, payload hash, draft
 * freshness, idempotency); retries of a decision that already went through return it again.
 */
export async function decideSnapshot(
  input: z.infer<typeof decisionSchema>,
): Promise<{ error?: DecisionError | "invalid"; view?: ApprovalView }> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const db = await appDb();
  const result = await decideApproval(db, parsed.data);
  const view = await getApprovalView(db, parsed.data.approvalId);
  const visible = view && view.threadId === parsed.data.threadId ? view : undefined;
  return result.ok ? { view: visible } : { error: result.error, view: visible };
}
