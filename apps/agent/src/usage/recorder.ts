import { type Db, type NewRunEvent, recordRunEvents } from "@copilot/db";
import type { WebProviders } from "../web/providers";
import { estimateLlmUsd, estimateProviderUsd, type TokenUsage } from "./prices";
import { sanitizeForEvent } from "./sanitize";

export type Actor = "copilot" | "researcher" | "rescorer" | "triager" | "observer" | "ingest";

/**
 * Collects one run's events (one row per model call or provider call) and writes them in
 * order. Tools reach the recorder of their chat's active run via `recorderFor(threadId)`.
 */
export class RunRecorder {
  private writes: Promise<void> = Promise.resolve();
  private pending: NewRunEvent[] = [];
  runId: string | null = null;
  private toolStarts = new Map<string, number>();
  readonly startedAt = Date.now();
  firstTextAt: number | null = null;

  constructor(
    private readonly db: Db,
    readonly threadId: string,
  ) {}

  /** The run id is known once the durable stream starts (and its app_runs row exists). */
  attach(runId: string) {
    this.runId = runId;
    const buffered = this.pending.map((e) => ({ ...e, runId }));
    this.pending = [];
    this.write(buffered);
  }

  private write(rows: NewRunEvent[]) {
    this.writes = this.writes
      .then(() => recordRunEvents(this.db, rows))
      .catch((error) => console.error("could not record run event", error));
  }

  private push(event: Omit<NewRunEvent, "runId" | "at"> & { at?: Date }) {
    const row: NewRunEvent = { ...event, runId: this.runId ?? "", at: event.at ?? new Date() };
    if (this.runId) this.write([row]);
    else this.pending.push(row);
  }

  llm(actor: Actor, modelId: string, usage: TokenUsage, durationMs?: number) {
    this.push({
      type: "llm",
      category: actor === "observer" ? "memory" : "llm",
      name: modelId,
      actor,
      status: "ok",
      durationMs: durationMs ?? null,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      cacheWriteTokens: usage.cacheCreationInputTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
      estimatedUsd: estimateLlmUsd(modelId, usage),
    });
  }

  provider(
    actor: Actor,
    call: Parameters<typeof estimateProviderUsd>[0],
    detail: { status: "ok" | "error"; durationMs: number; data: Record<string, unknown> },
  ) {
    this.push({
      type: "provider",
      category:
        call.provider === "firecrawl" ? "browser" : call.op === "search" ? "search" : "extraction",
      name: `${call.provider}.${call.op}`,
      actor,
      status: detail.status,
      durationMs: detail.durationMs,
      estimatedUsd: estimateProviderUsd(call),
      data: sanitizeForEvent(detail.data) as Record<string, unknown>,
    });
  }

  toolStart(toolCallId: string) {
    this.toolStarts.set(toolCallId, Date.now());
  }

  toolEnd(toolCallId: string, name: string, args: unknown, result: unknown, failed: boolean) {
    const started = this.toolStarts.get(toolCallId);
    this.toolStarts.delete(toolCallId);
    this.push({
      type: "tool",
      category: "app",
      name,
      actor: "copilot",
      status: failed ? "error" : "ok",
      durationMs: started ? Date.now() - started : null,
      data: sanitizeForEvent({ args, result }) as Record<string, unknown>,
    });
  }

  retry(what: string, attempt: number, reason: string) {
    this.push({
      type: "retry",
      category: "app",
      name: what,
      status: "error",
      data: { attempt, reason },
    });
  }

  compaction(name: string, data: Record<string, unknown> = {}) {
    this.push({
      type: "compaction",
      category: "memory",
      name,
      status: "ok",
      data: sanitizeForEvent(data) as Record<string, unknown>,
    });
  }

  error(name: string, message: string) {
    this.push({
      type: "error",
      category: "app",
      name,
      status: "error",
      data: { message: message.slice(0, 300) },
    });
  }

  noteText() {
    this.firstTextAt ??= Date.now();
  }

  /** Waits until every event so far is written. */
  flush(): Promise<void> {
    return this.writes;
  }
}

const active = new Map<string, RunRecorder>();

export const registerRecorder = (recorder: RunRecorder) => active.set(recorder.threadId, recorder);
export const releaseRecorder = (recorder: RunRecorder) => {
  if (active.get(recorder.threadId) === recorder) active.delete(recorder.threadId);
};
export const recorderFor = (threadId?: string) => (threadId ? active.get(threadId) : undefined);

/** Wraps web providers so every provider call (each retry attempt included) is one event. */
export function meterWeb<W extends WebProviders | null>(
  web: W,
  recorder: RunRecorder | undefined,
  actor: Actor,
): W {
  if (!web || !recorder) return web;
  const inner: WebProviders = web;
  const timed = async <T>(
    call: Parameters<typeof estimateProviderUsd>[0],
    data: Record<string, unknown>,
    fn: () => Promise<T>,
    ok: (result: T) => boolean,
  ): Promise<T> => {
    const started = Date.now();
    try {
      const result = await fn();
      recorder.provider(actor, call, {
        status: ok(result) ? "ok" : "error",
        durationMs: Date.now() - started,
        data,
      });
      return result;
    } catch (error) {
      recorder.provider(actor, call, {
        status: "error",
        durationMs: Date.now() - started,
        data: { ...data, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  };
  const scrape = inner.scrape;
  const metered: WebProviders = {
    search: (query, options, signal) =>
      timed(
        { provider: "tavily", op: "search" },
        { query },
        () => inner.search(query, options, signal),
        () => true,
      ),
    extract: (url, depth, signal) =>
      timed(
        { provider: "tavily", op: "extract", depth },
        { url, depth },
        () => inner.extract(url, depth, signal),
        (r) => r.ok,
      ),
    scrape: scrape
      ? (url, signal) =>
          timed(
            { provider: "firecrawl", op: "scrape" },
            { url },
            () => scrape(url, signal),
            (r) => r.ok,
          )
      : null,
  };
  return metered as W;
}
