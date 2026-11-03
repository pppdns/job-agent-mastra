import { randomUUID } from "node:crypto";
import {
  AssessmentError,
  currentProfile,
  type Db,
  getJobDetail,
  latestListingSource,
  listJobs,
  saveDraft,
} from "@copilot/db";
import { type Assessment, assessmentSchema } from "@copilot/shared";
import type { TracingContext } from "@mastra/core/observability";
import { env } from "../env";
import { parseStoredListing } from "../ingest/listing";
import { rescorerAgent } from "../mastra/agents/rescorer";
import { formatProfile } from "../mastra/profile-context";
import type { RunRecorder } from "../usage/recorder";

/** Most jobs one batch re-scores (a known maximum cost per click). */
export const MAX_RESCORE_JOBS = 25;
const CONCURRENCY = 3;

export type RescoreResult =
  | {
      jobId: string;
      title: string | null;
      company: string | null;
      status: "saved";
      draftId: string;
      version: number;
      before: { verdict?: string; fitLevel?: string };
      after: { verdict: string; fitLevel?: string; headline?: string };
    }
  | {
      jobId: string;
      title: string | null;
      company: string | null;
      status: "failed";
      reason: string;
    };

export type RescoreEvent =
  | { kind: "start"; total: number; skipped: number; profileVersion: number }
  | ({ kind: "job" } & RescoreResult)
  | { kind: "done"; status: "completed" | "cancelled"; saved: number; failed: number };

export type RescoreDeps = {
  db: Db;
  threadId?: string;
  /** The parent run's abort signal (user stop). */
  signal?: AbortSignal;
  /** Streams a progress event to the chat (data-rescore-progress). */
  emit: (data: RescoreEvent & { runId: string }) => Promise<void> | undefined;
  tracingContext?: TracingContext;
  recorder?: RunRecorder;
};

/**
 * Re-assesses saved jobs against the current approved profile: one fresh model call per job
 * (so context and cost stay per job), each saved as a new draft. Without `jobIds`, every job
 * whose latest draft predates the profile. Drafts already saved are kept if the run stops.
 */
export async function runRescore(input: { jobIds?: string[] }, deps: RescoreDeps) {
  const runId = randomUUID();
  const profile = await currentProfile(deps.db);
  const jobs = (await listJobs(deps.db, input.jobIds)).filter(
    (j) => j.draftVersion !== null && (input.jobIds || j.profileStale),
  );
  const batch = jobs.slice(0, MAX_RESCORE_JOBS);
  const emit = (event: RescoreEvent) => deps.emit({ runId, ...event });
  await emit({
    kind: "start",
    total: batch.length,
    skipped: jobs.length - batch.length,
    profileVersion: profile.version,
  });

  const results: RescoreResult[] = [];
  const queue = [...batch];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (deps.signal?.aborted) return;
      const identity = { jobId: job.id, title: job.title, company: job.company };
      let result: RescoreResult;
      try {
        result = await rescoreOne(job.id, profile, deps);
      } catch (error) {
        if (deps.signal?.aborted) return;
        const reason =
          error instanceof AssessmentError ? error.message : "the model call failed; try again";
        if (!(error instanceof AssessmentError)) console.error("rescore failed", error);
        result = { ...identity, status: "failed", reason };
      }
      results.push(result);
      await emit({ kind: "job", ...result });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const status = deps.signal?.aborted ? ("cancelled" as const) : ("completed" as const);
  const saved = results.filter((r) => r.status === "saved").length;
  await emit({ kind: "done", status, saved, failed: results.length - saved });
  return {
    status,
    runId,
    profileVersion: profile.version,
    skipped: jobs.length - batch.length,
    results,
    note: "Results are new drafts, not approved. The app shows an approve-all button.",
  };
}

type Profile = Awaited<ReturnType<typeof currentProfile>>;

async function rescoreOne(jobId: string, profile: Profile, deps: RescoreDeps) {
  const detail = await getJobDetail(deps.db, jobId);
  if (!detail) throw new AssessmentError(`unknown job id ${jobId}`);
  const { job } = detail;
  const identity = { jobId, title: job.title, company: job.company };
  const source = await latestListingSource(deps.db, jobId);
  if (!source) throw new AssessmentError("no stored listing; share the listing again");
  const listing = parseStoredListing(source.kind, source.content);

  const prompt = [
    formatProfile(profile),
    `Job: ${[job.title, job.company, job.location].filter(Boolean).join(" · ")}`,
    `Listing (source id ${source.id}${source.truncated ? ", truncated" : ""}):`,
    Object.entries(listing.criteria)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    listing.description,
    detail.claims.length > 0 &&
      [
        "Research findings:",
        ...detail.claims.map(
          (c) =>
            `- [${c.evidence}; sources ${c.sourceIds.join(", ") || "none"}${c.publishedAt ? `; published ${c.publishedAt}` : ""}] ${c.text}`,
        ),
      ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const generate = async (text: string) => {
    const started = Date.now();
    const generated = await rescorerAgent.generate(text, {
      structuredOutput: { schema: assessmentSchema },
      abortSignal: deps.signal,
      tracingContext: deps.tracingContext,
      onStepFinish: ({ usage }) => {
        deps.recorder?.llm("rescorer", env.COPILOT_MODEL, usage ?? {}, Date.now() - started);
      },
    });
    return generated.object as Assessment;
  };
  const save = (assessment: Assessment) =>
    saveDraft(deps.db, {
      jobId,
      assessment,
      threadId: deps.threadId,
      profileVersion: profile.version,
    });

  let assessment = await generate(prompt);
  let draft: Awaited<ReturnType<typeof save>>;
  try {
    draft = await save(assessment);
  } catch (error) {
    // One retry with the rule the draft broke (like the copilot's tool loop); then the job fails.
    if (!(error instanceof AssessmentError) || deps.signal?.aborted) throw error;
    assessment = await generate(
      `${prompt}\n\nYour previous assessment was rejected: ${error.message}\nFix that and return the full assessment again.`,
    );
    draft = await save(assessment);
  }
  const before = detail.draft?.assessment;
  return {
    ...identity,
    status: "saved" as const,
    draftId: draft.id,
    version: draft.version,
    before: { verdict: before?.recommendation.verdict, fitLevel: before?.fitLevel },
    after: {
      verdict: assessment.recommendation.verdict,
      fitLevel: assessment.fitLevel,
      headline: assessment.headline,
    },
  };
}
