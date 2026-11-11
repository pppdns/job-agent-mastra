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
import {
  type Assessment,
  MAX_RESCORE_JOBS,
  modelAssessmentSchema,
  normalizeModelAssessment,
} from "@copilot/shared";
import type { Agent } from "@mastra/core/agent";
import type { TracingContext } from "@mastra/core/observability";
import { parseStoredListing } from "../ingest/listing";
import { rescorerAgent } from "../mastra/agents/rescorer";
import { rescoreModelId } from "../mastra/models";
import { formatProfile } from "../mastra/profile-context";
import type { RunRecorder } from "../usage/recorder";

export { MAX_RESCORE_JOBS };

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
 * whose latest draft predates the profile, except archived ones; with `all`, every assessed
 * active job, stale first, then least recently updated, so repeated batches move on through
 * the list. Drafts already saved are kept if the run stops.
 */
export async function runRescore(input: { jobIds?: string[]; all?: boolean }, deps: RescoreDeps) {
  const runId = randomUUID();
  const profile = await currentProfile(deps.db);
  const jobs = (await listJobs(deps.db, input.jobIds)).filter(
    (j) =>
      j.draftVersion !== null &&
      (input.jobIds || (j.archivedAt === null && (input.all || j.profileStale))),
  );
  if (input.all && !input.jobIds) {
    jobs.sort(
      (a, b) =>
        Number(b.profileStale) - Number(a.profileStale) ||
        a.updatedAt.getTime() - b.updatedAt.getTime(),
    );
  }
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
        result = await assessJob(job.id, profile, deps);
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
    note: "Each result is saved as the job's new current assessment. The app shows them all.",
  };
}

export type Profile = Awaited<ReturnType<typeof currentProfile>>;

export type AssessDeps = Pick<
  RescoreDeps,
  "db" | "threadId" | "signal" | "tracingContext" | "recorder"
> & {
  /** Another rescorer (model comparison evals); default the RESCORE_MODEL agent. */
  rescorer?: { agent: Agent; modelId: string };
  /** Each model call's usage and provider metadata (evals read the gateway's cost). */
  onModelCall?: (step: { usage?: unknown; providerMetadata?: unknown }) => void;
};

/**
 * One full assessment of a saved job against `profile` (structured output, no tools), saved as
 * its next draft; one retry with the rule a rejected draft broke. Used by re-score and by
 * discovery for the best new matches. Works for a job without an earlier draft.
 */
export async function assessJob(jobId: string, profile: Profile, deps: AssessDeps) {
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

  const { agent, modelId } = deps.rescorer ?? {
    agent: rescorerAgent,
    modelId: rescoreModelId(),
  };
  const generate = async (text: string) => {
    const started = Date.now();
    const generated = await agent.generate(text, {
      structuredOutput: { schema: modelAssessmentSchema },
      // OpenAI's strict JSON mode rejects schemas with optional fields (quote, salary, …).
      providerOptions: { openai: { strictJsonSchema: false } },
      abortSignal: deps.signal,
      tracingContext: deps.tracingContext,
      onStepFinish: ({ usage, providerMetadata }) => {
        deps.recorder?.llm("rescorer", modelId, usage ?? {}, Date.now() - started);
        deps.onModelCall?.({ usage, providerMetadata });
      },
    });
    return normalizeModelAssessment(generated.object);
  };
  const save = (assessment: Assessment) =>
    saveDraft(deps.db, {
      jobId,
      assessment,
      threadId: deps.threadId,
      profileVersion: profile.version,
    });

  const finish = finishOf(identity, detail.draft?.assessment);
  const retry = (reason: string) =>
    `${prompt}\n\nYour previous assessment was rejected: ${reason}\nFix that and return the full assessment again.`;
  // One retry for either kind of rejection: the output schema (e.g. a headline over its length
  // limit) or a saveDraft rule (like the copilot's tool loop); then the job fails.
  let assessment: Assessment;
  try {
    assessment = await generate(prompt);
  } catch (error) {
    if (!isSchemaRejection(error) || deps.signal?.aborted) throw error;
    assessment = await generate(retry((error as Error).message));
    return finish(assessment, await save(assessment));
  }
  let draft: Awaited<ReturnType<typeof save>>;
  try {
    draft = await save(assessment);
  } catch (error) {
    if (!(error instanceof AssessmentError) || deps.signal?.aborted) throw error;
    assessment = await generate(retry(error.message));
    draft = await save(assessment);
  }
  return finish(assessment, draft);
}

/** The model's structured output failed the schema (Mastra's validation error). */
const isSchemaRejection = (error: unknown) =>
  error instanceof Error && error.message.includes("Structured output validation failed");

function finishOf(
  identity: { jobId: string; title: string | null; company: string | null },
  before: Assessment | undefined,
) {
  return (assessment: Assessment, draft: { id: string; version: number }) => ({
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
  });
}
