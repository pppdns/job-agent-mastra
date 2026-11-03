"use server";

import {
  type ApprovalView,
  AssessmentError,
  type DecisionError,
  decideApproval,
  getApprovalView,
  proposeProfileChange,
} from "@copilot/db";
import { refresh } from "next/cache";
import { z } from "zod";
import { PROFILE_PAGE_THREAD, threadIdSchema, threadTitleSchema } from "@/lib/chat-schema";
import { appDb } from "@/server/db";
import { deleteThread, renameThread, setThreadArchived } from "@/server/threads";

export async function renameChat(threadId: string, title: string): Promise<void> {
  await renameThread(threadIdSchema.parse(threadId), threadTitleSchema.parse(title));
  refresh();
}

export async function deleteChat(threadId: string): Promise<void> {
  await deleteThread(threadIdSchema.parse(threadId));
  refresh();
}

export async function setChatArchived(threadId: string, archived: boolean): Promise<void> {
  await setThreadArchived(threadIdSchema.parse(threadId), z.boolean().parse(archived));
  refresh();
}

const decisionSchema = z.object({
  approvalId: z.string().min(1).max(64),
  threadId: threadIdSchema,
  decision: z.enum(["approve", "reject"]),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * The user's approve/reject click on a snapshot or profile change. App code enforces the rules (chat, payload hash, draft
 * freshness, idempotency); retries of a decision that already went through return it again.
 */
export async function decideApprovalAction(
  input: z.infer<typeof decisionSchema>,
): Promise<{ error?: DecisionError | "invalid"; view?: ApprovalView }> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const db = await appDb();
  const result = await decideApproval(db, parsed.data);
  const view = await getApprovalView(db, parsed.data.approvalId);
  const visible = view && view.threadId === parsed.data.threadId ? view : undefined;
  refresh(); // profile page, jobs pages and their badges read the new state
  return result.ok ? { view: visible } : { error: result.error, view: visible };
}

/**
 * Profile page edits never change the profile directly: they become a proposal (bound to
 * the profile page) that the user then approves on the same page.
 */
export async function proposeProfileEdit(proposal: unknown): Promise<{ error?: string }> {
  try {
    await proposeProfileChange(await appDb(), { threadId: PROFILE_PAGE_THREAD, proposal });
  } catch (error) {
    if (error instanceof AssessmentError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}
