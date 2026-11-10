import { type Db, type DiscoveryStep, type RunProgress, recordProgress } from "@copilot/db";
import { DISCOVERY_SOURCE_LABELS, type DiscoverySource } from "@copilot/shared";

// Live position of a running discovery run, saved on the run row for the /discovery page (Studio
// shows nothing until a run ends) and logged for `fly logs`. Step and source changes are saved at
// once; work counts at most every few seconds. A failed write never stops the run.

const MIN_WRITE_MS = 2_000;

export type ProgressReporter = {
  step(step: DiscoveryStep): void;
  source(source: DiscoverySource): void;
  work(done: number, total: number, label?: string): void;
  /** Waits for the last write (call before the step returns). */
  flush(): Promise<void>;
};

export function createProgress(
  db: Db,
  runId: string,
  options: { now?: () => Date; minWriteMs?: number; log?: (line: string) => void } = {},
): ProgressReporter {
  const now = options.now ?? (() => new Date());
  const minWriteMs = options.minWriteMs ?? MIN_WRITE_MS;
  const log = options.log ?? ((line: string) => console.info(line));
  let state: RunProgress | null = null;
  let lastWrite = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  const write = () => {
    if (pending) clearTimeout(pending);
    pending = null;
    if (!state) return;
    lastWrite = Date.now();
    const snapshot = { ...state, updatedAt: now().toISOString() };
    writing = writing
      .then(() => recordProgress(db, runId, snapshot))
      .catch((error) => console.error("discovery progress write failed", String(error)));
  };
  const throttled = () => {
    const wait = minWriteMs - (Date.now() - lastWrite);
    if (wait <= 0) write();
    else pending ??= setTimeout(write, wait);
  };

  return {
    step(step) {
      const at = now().toISOString();
      state = { step, stepStartedAt: at, updatedAt: at };
      log(`discovery ${runId}: ${step}`);
      write();
    },
    source(source) {
      const at = now().toISOString();
      state = {
        step: "fetch",
        stepStartedAt: state?.stepStartedAt ?? at,
        source,
        sourceStartedAt: at,
        updatedAt: at,
      };
      log(`discovery ${runId}: fetching ${DISCOVERY_SOURCE_LABELS[source]}`);
      write();
    },
    work(done, total, label) {
      if (!state) return;
      state = { ...state, done, total, label };
      throttled();
    },
    async flush() {
      if (pending) write();
      await writing;
    },
  };
}

/** A reporter that does nothing (tests, callers without a run). */
export const noProgress: ProgressReporter = {
  step: () => undefined,
  source: () => undefined,
  work: () => undefined,
  flush: async () => undefined,
};
