"use server";

import { randomUUID } from "node:crypto";
import {
  type ApprovalView,
  AssessmentError,
  type DecisionError,
  decideApproval,
  editProfile,
  getApprovalView,
  getSearchSettings,
  keepJob,
  keepPosting,
  listJobs,
  markJobSeen,
  rescreenPostings,
  resetStaleTriage,
  saveSearchSettings,
  setJobArchived,
  setJobStatus,
  setJobsStatus,
} from "@copilot/db";
import {
  ASSESS_BATCH_SIZES,
  DISCOVERY_SOURCES,
  type DiscoverySource,
  JOB_STATUSES,
  RESCORE_BATCH_SIZES,
  RESEARCH_TOPICS,
  type RescoreLimit,
  researchRequestText,
  type SearchSettings,
  screenPosting,
  searchSettingsSchema,
} from "@copilot/shared";
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
/** The fixed messages the re-score buttons send; the copilot answers them with rescore_jobs. */
const RESCORE_MESSAGES = {
  stale: (limit: string) =>
    `Re-score my jobs that were assessed with an older profile (rescore_jobs with limit: ${limit}).`,
  all: (limit: string) =>
    `Re-score all my active jobs (rescore_jobs with all: true, limit: ${limit}).`,
} as const;

const isRescoreLimit = (limit: unknown): limit is RescoreLimit =>
  limit === "all" || (RESCORE_BATCH_SIZES as readonly unknown[]).includes(limit);

/**
 * "Re-score" on /jobs (stale jobs, or all active ones): starts the run in a new chat, then
 * opens it. The run is durable, so the chat page reconnects to it; closing our copy of the
 * stream doesn't stop it.
 */
export async function startRescoreAction(
  scope: keyof typeof RESCORE_MESSAGES,
  limit: RescoreLimit,
): Promise<{ error?: string }> {
  // Server actions are callable with any payload: reject unknown values instead of guessing.
  if (!Object.hasOwn(RESCORE_MESSAGES, scope)) return { error: "unknown re-score scope" };
  if (!isRescoreLimit(limit)) return { error: "unknown re-score batch size" };
  return startChat(RESCORE_MESSAGES[scope](limit === "all" ? '"all"' : String(limit)));
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

export type DiscoveryActionState = { ok: boolean; message: string } | null;

const DISCOVERY_RUNS = {
  now: { body: { mode: "fetch" }, started: "Started a discovery run." },
  "backfill-7": { body: { mode: "fetch", lookbackDays: 7 }, started: "Started a 7-day backfill." },
  "backfill-30": {
    body: { mode: "fetch", lookbackDays: 30 },
    started: "Started a 30-day backfill.",
  },
  triage: { body: { mode: "triage" }, started: "Triaging the next batch of waiting jobs." },
  assess: { body: { mode: "assess" }, started: "Assessing more matches." },
} as const;

/**
 * The /discovery buttons: "Run now", a 7- or 30-day backfill, "Triage next batch" or "Assess
 * more matches" (with the picked batch size, `assessLimit`). Each starts the discover-jobs
 * workflow (one run at a time).
 */
export async function startDiscoveryAction(
  _prev: DiscoveryActionState,
  formData: FormData,
): Promise<DiscoveryActionState> {
  const kind = z
    .enum(["now", "backfill-7", "backfill-30", "triage", "assess"])
    .catch("now")
    .parse(formData.get("run") ?? "now");
  // Server actions take any payload: only the offered batch sizes, else the smallest.
  const assessLimit =
    ASSESS_BATCH_SIZES.find((n) => n === Number(formData.get("assessLimit"))) ??
    ASSESS_BATCH_SIZES[0];
  const body = kind === "assess" ? { mode: "assess", assessLimit } : DISCOVERY_RUNS[kind].body;
  const response = await agentFetch("/discovery/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  refresh();
  if (!response) return { ok: false, message: "The agent server is not reachable." };
  if (response.status === 409) return { ok: false, message: "A discovery run is already running." };
  if (!response.ok) return { ok: false, message: `Could not start the run (${response.status}).` };
  const started =
    kind === "assess" ? `Assessing up to ${assessLimit} matches.` : DISCOVERY_RUNS[kind].started;
  return { ok: true, message: started };
}

/** "Stop run": cancels the running discovery run; it ends as interrupted. */
export async function stopDiscoveryAction(): Promise<DiscoveryActionState> {
  const response = await agentFetch("/discovery/stop", { method: "POST" }).catch(() => null);
  refresh();
  if (!response) return { ok: false, message: "The agent server is not reachable." };
  if (response.status === 409) return { ok: false, message: "No discovery run is running." };
  if (!response.ok) return { ok: false, message: `Could not stop the run (${response.status}).` };
  return { ok: true, message: "Stopped the run." };
}

/** One entry per line (or comma), trimmed, empties dropped. */
const lines = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);

const numberOr = (value: FormDataEntryValue | null, fallback: number) => {
  const n = Number(value);
  return value === null || value === "" || Number.isNaN(n) ? fallback : n;
};

/** Adds each source's "hours between runs" field (`<id>MinHoursBetweenRuns`) to its settings. */
const withSchedule = (
  formData: FormData,
  current: SearchSettings,
  sources: Partial<Record<DiscoverySource, Record<string, unknown>>>,
) =>
  Object.fromEntries(
    DISCOVERY_SOURCES.map((id) => [
      id,
      {
        ...sources[id],
        minHoursBetweenRuns: numberOr(
          formData.get(`${id}MinHoursBetweenRuns`),
          current.sources[id].minHoursBetweenRuns,
        ),
      },
    ]),
  );

/** Days of postings a settings change re-screens (older ones aren't shown anyway). */
const RESCREEN_DAYS = 60;

/**
 * Saves the search settings and re-screens recent postings at once: newly passing ones become
 * jobs, untouched discovered jobs that now fail are hidden. Age is judged as of when a posting
 * arrived, with the backfill window of the run that brought it.
 */
export async function saveSearchSettingsAction(
  _prev: DiscoveryActionState,
  formData: FormData,
): Promise<DiscoveryActionState> {
  const db = await appDb();
  const current = await getSearchSettings(db);
  const amount = formData.get("minSalaryAmount");
  const currency = String(formData.get("minSalaryCurrency") ?? "")
    .trim()
    .toUpperCase();
  const parsed = searchSettingsSchema.safeParse({
    ...current,
    queries: lines(formData.get("queries")),
    titleExclude: lines(formData.get("titleExclude")),
    blockedCompanies: lines(formData.get("blockedCompanies")),
    remoteRegions: lines(formData.get("remoteRegions")),
    onsitePlaces: lines(formData.get("onsitePlaces")),
    maxAgeDays: numberOr(formData.get("maxAgeDays"), current.maxAgeDays),
    minSalary: amount && currency ? { amount: Number(amount), currency } : null,
    triageThreshold: numberOr(formData.get("triageThreshold"), current.triageThreshold),
    digestThreshold: numberOr(formData.get("digestThreshold"), current.digestThreshold),
    maxAssessmentsPerRun: numberOr(
      formData.get("maxAssessmentsPerRun"),
      current.maxAssessmentsPerRun,
    ),
    maxTriagePerRun: numberOr(formData.get("maxTriagePerRun"), current.maxTriagePerRun),
    maxLlmUsdPerRun: numberOr(formData.get("maxLlmUsdPerRun"), current.maxLlmUsdPerRun),
    apifyMonthlyBudgetUsd: numberOr(
      formData.get("apifyMonthlyBudgetUsd"),
      current.apifyMonthlyBudgetUsd,
    ),
    sources: withSchedule(formData, current, {
      himalayas: {
        enabled: formData.get("himalayasEnabled") === "on",
        maxPages: numberOr(formData.get("himalayasMaxPages"), current.sources.himalayas.maxPages),
      },
      weworkremotely: {
        enabled: formData.get("weworkremotelyEnabled") === "on",
        categories: lines(formData.get("weworkremotelyCategories")),
      },
      remoteok: { enabled: formData.get("remoteokEnabled") === "on" },
      remotive: { enabled: formData.get("remotiveEnabled") === "on" },
      nodesk: {
        enabled: formData.get("nodeskEnabled") === "on",
        categories: lines(formData.get("nodeskCategories")),
      },
      ...Object.fromEntries(
        (["ycombinator", "jobgether", "dice", "builtin", "hiringcafe"] as const).map((id) => [
          id,
          {
            enabled: formData.get(`${id}Enabled`) === "on",
            limitPerSearch: numberOr(
              formData.get(`${id}LimitPerSearch`),
              current.sources[id].limitPerSearch,
            ),
            maxUsdPerRun: numberOr(
              formData.get(`${id}MaxUsdPerRun`),
              current.sources[id].maxUsdPerRun,
            ),
          },
        ]),
      ),
      wellfound: {
        enabled: formData.get("wellfoundEnabled") === "on",
        roles: lines(formData.get("wellfoundRoles")),
        maxUsdPerRun: numberOr(
          formData.get("wellfoundMaxUsdPerRun"),
          current.sources.wellfound.maxUsdPerRun,
        ),
      },
      careersites: {
        enabled: formData.get("careersitesEnabled") === "on",
        limit: numberOr(formData.get("careersitesLimit"), current.sources.careersites.limit),
        maxUsdPerRun: numberOr(
          formData.get("careersitesMaxUsdPerRun"),
          current.sources.careersites.maxUsdPerRun,
        ),
      },
      linkedin: {
        enabled: formData.get("linkedinEnabled") === "on",
        locations: lines(formData.get("linkedinLocations")),
        limitPerSearch: numberOr(
          formData.get("linkedinLimitPerSearch"),
          current.sources.linkedin.limitPerSearch,
        ),
        maxUsdPerRun: numberOr(
          formData.get("linkedinMaxUsdPerRun"),
          current.sources.linkedin.maxUsdPerRun,
        ),
      },
    }),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message: `Not saved: ${issue?.path.join(".") || "settings"}: ${issue?.message}`,
    };
  }
  const settings = parsed.data;
  await saveSearchSettings(db, settings);
  const result = await rescreenPostings(
    db,
    (posting, intake) =>
      screenPosting(
        settings,
        posting,
        intake.seenAt,
        Math.max(settings.maxAgeDays, intake.lookbackDays ?? 0),
      ),
    new Date(Date.now() - RESCREEN_DAYS * 86_400_000),
  );
  refresh();
  const changes = [
    result.promoted && `${result.promoted} new job${result.promoted === 1 ? "" : "s"} let through`,
    result.hidden && `${result.hidden} hidden`,
    result.shown && `${result.shown} shown again`,
  ].filter(Boolean);
  return {
    ok: true,
    message: `Saved. Re-screened ${result.checked} recent postings${changes.length ? `: ${changes.join(", ")}` : ", nothing changed"}.`,
  };
}

/** The user opened a discovered job: it no longer counts as a new match. */
export async function markJobSeenAction(jobId: string): Promise<void> {
  await markJobSeen(await appDb(), jobIdSchema.parse(jobId));
  refresh();
}

const jobIdsSchema = z.array(jobIdSchema).min(1).max(200);

/** Bulk Shortlist / Dismiss from the job list. */
export async function setJobsStatusAction(jobIds: string[], status: string): Promise<number> {
  const changed = await setJobsStatus(
    await appDb(),
    jobIdsSchema.parse(jobIds),
    z.enum(JOB_STATUSES).parse(status),
  );
  refresh();
  return changed;
}

/** "Keep anyway" on a job hidden by the triage threshold. */
export async function keepJobAction(jobId: string): Promise<void> {
  await keepJob(await appDb(), jobIdSchema.parse(jobId));
  refresh();
}

/** "Keep anyway" on a posting the screen dropped: it becomes a job that stays visible. */
export async function keepPostingAction(postingId: string): Promise<void> {
  await keepPosting(await appDb(), jobIdSchema.parse(postingId));
  refresh();
}

/** Clears triage made against an older profile; the next discovery run triages those again. */
export async function resetStaleTriageAction(): Promise<number> {
  const cleared = await resetStaleTriage(await appDb());
  refresh();
  return cleared;
}

export type AssessJobState = { ok: boolean; message: string } | null;

/** "Assess fully" on a discovered job: one structured assessment on the agent (~30 s). */
export async function assessJobAction(jobId: string): Promise<AssessJobState> {
  const id = jobIdSchema.parse(jobId);
  const response = await agentFetch(`/jobs/${encodeURIComponent(id)}/assess`, {
    method: "POST",
  }).catch(() => null);
  refresh();
  if (!response) return { ok: false, message: "The agent server is not reachable." };
  const body = (await response.json().catch(() => ({}))) as { error?: string; version?: number };
  if (!response.ok)
    return { ok: false, message: body.error ?? `Assessment failed (${response.status}).` };
  return { ok: true, message: `Assessment v${body.version} saved.` };
}
