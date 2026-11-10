import {
  AssessmentError,
  currentProfile,
  type Db,
  getSearchSettings,
  jobsToAssess,
} from "@copilot/db";
import type { TracingContext } from "@mastra/core/observability";
import { assessJob, type Profile } from "../rescore/run";
import type { RunRecorder } from "../usage/recorder";
import type { DiscoveryBudget } from "./budget";
import { noteError } from "./errors";

// The best new matches of a run get a full assessment (the same structured assessor as re-score,
// with the deterministic saveDraft rules), best triage score first, within the run's budget.

const CONCURRENCY = 3;

export type AssessOutcome = { assessed: number; failed: number; errors: string[] };

export type AssessTopDeps = {
  db: Db;
  /** Only jobs triaged since then (this run) are candidates; unset = every open match. */
  since?: Date;
  budget: DiscoveryBudget;
  threadId: string;
  recorder?: RunRecorder;
  tracingContext?: TracingContext;
  signal?: AbortSignal;
  /** The assessment call; injectable for tests. */
  assess?: (jobId: string, profile: Profile) => Promise<unknown>;
  /** Called after each job (`done` of `total` candidates). */
  onProgress?: (done: number, total: number) => void;
};

export async function assessTopMatches(deps: AssessTopDeps): Promise<AssessOutcome> {
  const { db } = deps;
  const call =
    deps.assess ?? ((jobId: string, profile: Profile) => assessJob(jobId, profile, deps));
  const [profile, settings] = await Promise.all([currentProfile(db), getSearchSettings(db)]);
  const queue = await jobsToAssess(db, {
    since: deps.since,
    threshold: settings.triageThreshold,
    limit: settings.maxAssessmentsPerRun,
  });
  const total = queue.length;
  deps.onProgress?.(0, total);
  let assessed = 0;
  let failed = 0;
  const errors: string[] = [];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (deps.signal?.aborted || !deps.budget.reserveAssessment()) return;
      try {
        await call(job.id, profile);
        assessed += 1;
      } catch (error) {
        if (deps.signal?.aborted) return;
        failed += 1;
        noteError(errors, error);
        if (error instanceof AssessmentError)
          console.error("assessment rejected", job.id, error.message);
        else console.error("assessment failed", job.id, error);
      }
      deps.onProgress?.(assessed + failed, total);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { assessed, failed, errors };
}
