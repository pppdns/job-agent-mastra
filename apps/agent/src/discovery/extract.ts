import {
  countAwaitingExtraction,
  currentPreferences,
  type Db,
  jobsAwaitingExtraction,
  latestListingSource,
  saveFacts,
} from "@copilot/db";
import {
  decideEligibility,
  extractPrompt,
  FACTS_VERSION,
  type ListingFactsInput,
  listingFactsSchema,
  type Preferences,
  verifyFacts,
} from "@copilot/shared";
import type { TracingContext } from "@mastra/core/observability";
import { env } from "../env";
import { extractorAgent } from "../mastra/agents/extractor";
import type { RunRecorder } from "../usage/recorder";
import type { DiscoveryBudget } from "./budget";
import { noteError } from "./errors";

// Listing facts: one fast structured call per job whose facts are missing or outdated
// (`FACTS_VERSION`), a few at a time, within the run's budget; then app code verifies the
// quotes and decides eligibility from home. Runs before triage, so triage skips jobs whose
// listing rules out home. A failed call leaves the job waiting for the next run.

const CONCURRENCY = 5;

export type ExtractDeps = {
  db: Db;
  recorder?: RunRecorder;
  tracingContext?: TracingContext;
  signal?: AbortSignal;
  /** Called after each call with its token usage (the run's budget). */
  settle?: (usage: Parameters<DiscoveryBudget["settleExtract"]>[1]) => void;
  /** The model call; injectable for tests. */
  extract?: (prompt: string, deps: ExtractDeps) => Promise<ListingFactsInput>;
};

export type ExtractOutcome = {
  extracted: number;
  failed: number;
  pending: number;
  errors: string[];
};

/** Extracts, verifies and decides one job's facts; false when it has no stored listing. */
export async function extractJobFacts(
  deps: ExtractDeps,
  job: { id: string; title: string | null; company: string | null },
  preferences: Preferences,
): Promise<boolean> {
  const source = await latestListingSource(deps.db, job.id);
  if (!source) return false;
  const call = deps.extract ?? extractWithModel;
  const raw = await call(extractPrompt(job, source.content), deps);
  const facts = verifyFacts(raw, source.content, job.title);
  await saveFacts(deps.db, job.id, {
    facts,
    version: FACTS_VERSION,
    decision: preferences.home ? decideEligibility(facts, preferences.home) : null,
  });
  return true;
}

/** The discovery step: jobs waiting for facts, the ones the user deals with first. */
export async function extractJobs(
  deps: ExtractDeps & {
    budget: DiscoveryBudget;
    limit: number;
    /** Only jobs triage will look at next (scheduled and triage runs); the backfill takes all. */
    untriagedOnly?: boolean;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<ExtractOutcome> {
  const { db, budget } = deps;
  const [queue, preferences] = await Promise.all([
    jobsAwaitingExtraction(db, {
      version: FACTS_VERSION,
      limit: deps.limit,
      untriagedOnly: deps.untriagedOnly,
    }),
    currentPreferences(db),
  ]);
  const total = queue.length;
  deps.onProgress?.(0, total);
  let extracted = 0;
  let failed = 0;
  const errors: string[] = [];
  const step: ExtractDeps = {
    ...deps,
    settle: (usage) => budget.settleExtract(env.COPILOT_FAST_MODEL, usage),
  };

  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (deps.signal?.aborted || !budget.reserveExtract()) return;
      try {
        if (!(await extractJobFacts(step, job, preferences))) throw new Error("no stored listing");
        extracted += 1;
      } catch (error) {
        if (deps.signal?.aborted) return;
        failed += 1;
        noteError(errors, error);
        console.error("extract failed", job.id, error instanceof Error ? error.message : error);
      }
      deps.onProgress?.(extracted + failed, total);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return {
    extracted,
    failed,
    errors,
    pending: await countAwaitingExtraction(db, FACTS_VERSION),
  };
}

async function extractWithModel(prompt: string, deps: ExtractDeps): Promise<ListingFactsInput> {
  const started = Date.now();
  const generated = await extractorAgent.generate(prompt, {
    structuredOutput: { schema: listingFactsSchema },
    abortSignal: deps.signal,
    tracingContext: deps.tracingContext,
    onStepFinish: ({ usage }) => {
      deps.settle?.(usage ?? {});
      deps.recorder?.llm("extractor", env.COPILOT_FAST_MODEL, usage ?? {}, Date.now() - started);
    },
  });
  return listingFactsSchema.parse(generated.object);
}
