"use server";

import { randomUUID } from "node:crypto";
import {
  type ApprovalView,
  AssessmentError,
  type DecisionError,
  decideApproval,
  editProfile,
  getApprovalView,
  listJobs,
  setJobArchived,
  setJobStatus,
} from "@copilot/db";
import { JOB_STATUSES, RESEARCH_TOPICS, researchRequestText } from "@copilot/shared";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PROFILE_PAGE_THREAD, threadIdSchema, threadTitleSchema } from "@/lib/chat-schema";
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
 * The user's approve/reject click on a profile change the copilot proposed. App code enforces
 * the rules (chat, payload hash, profile freshness, idempotency); retries of a decision that
 * already went through return it again.
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
  refresh(); // the profile page and stale-profile badges read the new state
  return result.ok ? { view: visible } : { error: result.error, view: visible };
}

/**
 * The user's own edit on the profile page: applies right away as a new profile version.
 * `baseVersion` is the version the page showed; if the profile moved since, nothing changes.
 */
export async function editProfileAction(
  proposal: unknown,
  baseVersion: number,
): Promise<{ error?: string }> {
  const version = z.number().int().min(0).safeParse(baseVersion);
  if (!version.success) return { error: "Invalid profile version." };
  try {
    await editProfile(await appDb(), {
      threadId: PROFILE_PAGE_THREAD,
      proposal,
      baseVersion: version.data,
    });
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
 * opens it. The message holds only the job id (checked to exist) and topic labels.
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
  return startChat(researchRequestText({ jobId: job.id, topics: [...new Set(picked.data)] }));
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
