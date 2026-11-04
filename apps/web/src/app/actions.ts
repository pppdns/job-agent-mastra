"use server";

import { randomUUID } from "node:crypto";
import {
  type ApprovalView,
  AssessmentError,
  approveDrafts,
  approvedDraftIds,
  type BatchApprovalOutcome,
  type DecisionError,
  decideApproval,
  getApprovalView,
  listJobs,
  proposeProfileChange,
  setJobArchived,
  setJobStatus,
} from "@copilot/db";
import { JOB_STATUSES, RESEARCH_TOPICS, researchRequestText } from "@copilot/shared";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  JOB_PAGE_THREAD,
  PROFILE_PAGE_THREAD,
  threadIdSchema,
  threadTitleSchema,
} from "@/lib/chat-schema";
import { agentFetch } from "@/server/agent";
import { toAgentChatBody } from "@/server/chat-body";
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

const jobIdSchema = z.string().min(1).max(64);

/** The user's own pipeline status for a job (rejected/dismissed archive it). */
export async function setJobStatusAction(jobId: string, status: string): Promise<void> {
  await setJobStatus(await appDb(), jobIdSchema.parse(jobId), z.enum(JOB_STATUSES).parse(status));
  refresh();
}

export async function setJobArchivedAction(jobId: string, archived: boolean): Promise<void> {
  await setJobArchived(await appDb(), jobIdSchema.parse(jobId), z.boolean().parse(archived));
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

// "use server" files may only export async functions.
/** The fixed message the "Re-score" button sends; the copilot answers it with rescore_jobs. */
const RESCORE_MESSAGE = "Re-score my jobs that were assessed with an older profile.";

/**
 * "Re-score stale jobs" on /jobs: starts the run in a new chat, then opens it. The run is
 * durable, so the chat page reconnects to it; closing our copy of the stream doesn't stop it.
 */
export async function startRescoreAction(): Promise<{ error?: string }> {
  return startChat(RESCORE_MESSAGE);
}

const researchTopicsSchema = z.array(z.enum(RESEARCH_TOPICS)).min(1).max(3);

/**
 * "Research next" on a job page: starts research on the picked topics in a new chat, then
 * opens it. The message names the job id; the company name comes from the database.
 */
export async function startResearchAction(
  jobId: string,
  topics: string[],
): Promise<{ error?: string }> {
  const id = jobIdSchema.safeParse(jobId);
  const picked = researchTopicsSchema.safeParse(topics);
  if (!id.success || !picked.success) return { error: "Invalid research request." };
  const [job] = await listJobs(await appDb(), [id.data]);
  if (!job) return { error: "This job no longer exists." };
  return startChat(
    researchRequestText({ jobId: job.id, company: job.company, topics: [...new Set(picked.data)] }),
  );
}

/** Sends `text` as the first message of a new chat, then opens it (the run is durable). */
async function startChat(text: string): Promise<{ error?: string }> {
  const threadId = randomUUID();
  const message = {
    id: randomUUID(),
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  };
  const upstream = await agentFetch("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toAgentChatBody({ threadId, message })),
  });
  await upstream.body?.cancel();
  if (!upstream.ok) return { error: "The agent server is unavailable." };
  redirect(`/c/${threadId}`);
}

const draftIdSchema = z.string().min(1).max(64);

const approveAllSchema = z.object({
  threadId: threadIdSchema,
  draftIds: z.array(draftIdSchema).min(1).max(50),
});

/**
 * "Approve all" on a re-score result: approves exactly the drafts that card showed. A job
 * whose draft changed since is skipped (`changed`), never approved with other content.
 */
export async function approveDraftsAction(
  input: z.infer<typeof approveAllSchema>,
): Promise<{ error?: "invalid"; results?: { draftId: string; outcome: BatchApprovalOutcome }[] }> {
  const parsed = approveAllSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const results = await approveDrafts(await appDb(), parsed.data);
  refresh();
  return { results: results.map(({ draftId, outcome }) => ({ draftId, outcome })) };
}

/**
 * "Approve" on a job page: approves exactly the draft the page showed. If the job got a newer
 * draft since, nothing is approved (`changed`).
 */
export async function approveJobDraftAction(
  draftId: string,
): Promise<{ error?: "invalid"; outcome?: BatchApprovalOutcome }> {
  const parsed = draftIdSchema.safeParse(draftId);
  if (!parsed.success) return { error: "invalid" };
  const [result] = await approveDrafts(await appDb(), {
    threadId: JOB_PAGE_THREAD,
    draftIds: [parsed.data],
  });
  refresh();
  return { outcome: result?.outcome };
}

/** Which of these drafts are approved, so a re-score card shows its state after a reload. */
export async function approvedDraftIdsAction(draftIds: string[]): Promise<string[]> {
  const parsed = z.array(draftIdSchema).max(50).safeParse(draftIds);
  return parsed.success ? approvedDraftIds(await appDb(), parsed.data) : [];
}
