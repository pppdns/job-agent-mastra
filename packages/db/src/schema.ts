import type { Assessment, EvidenceClass, ProfileFactKind, ResearchTopic } from "@copilot/shared";
import { JOB_STATUSES, POSTED_BASES, PROFILE_FACT_KINDS } from "@copilot/shared";
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// App-owned tables use the `app_` prefix; Mastra manages its own tables in the same file.

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("app_users", {
  id: text("id").primaryKey(),
  createdAt: createdAt(),
});

/** A job listing, deduplicated by LinkedIn id, canonical URL, or normalized company + title. */
export const jobs = sqliteTable(
  "app_jobs",
  {
    id: text("id").primaryKey(),
    linkedinJobId: text("linkedin_job_id").unique(),
    canonicalUrl: text("canonical_url").unique(),
    company: text("company"),
    title: text("title"),
    location: text("location"),
    dedupeKey: text("dedupe_key"),
    /** The user's own pipeline status; changed only by the user (UI or an explicit chat ask). */
    status: text("status", { enum: JOB_STATUSES }).notNull().default("new"),
    statusChangedAt: integer("status_changed_at", { mode: "timestamp_ms" }),
    /** Set when archived (closing statuses archive automatically); hidden from the active list. */
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("app_jobs_dedupe_key_idx").on(t.dedupeKey),
    index("app_jobs_archived_status_idx").on(t.archivedAt, t.status),
  ],
);

export const SOURCE_KINDS = ["linkedin", "ats", "web", "pasted"] as const;
export const SOURCE_PROVIDERS = ["tavily", "firecrawl", "user"] as const;
const POSTED_BASIS_VALUES = [...POSTED_BASES, "none"] as const;

/** A bounded snapshot of what was actually read for a job, with provenance. */
export const sources = sqliteTable(
  "app_sources",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
    provider: text("provider", { enum: SOURCE_PROVIDERS }).notNull(),
    url: text("url"),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    truncated: integer("truncated", { mode: "boolean" }).notNull(),
    threadId: text("thread_id"),
    retrievedAt: integer("retrieved_at", { mode: "timestamp_ms" }).notNull(),
    /** When the company posted the job, as this snapshot states it (`listingPostedDate`). */
    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    /** How `postedAt` was read; `none` = parsed, no date; null = not parsed yet (backfill). */
    postedBasis: text("posted_basis", { enum: POSTED_BASIS_VALUES }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("app_sources_job_content_uq").on(t.jobId, t.contentHash)],
);

/** Automatic, versioned assessment drafts. Every save is a new row; nothing is overwritten. */
export const jobDrafts = sqliteTable(
  "app_job_drafts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    assessment: text("assessment", { mode: "json" }).$type<Assessment>().notNull(),
    /** Approved profile version the assessment was written against (0 = empty profile). */
    profileVersion: integer("profile_version").notNull().default(0),
    threadId: text("thread_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("app_job_drafts_job_version_uq").on(t.jobId, t.version)],
);

/** A profile change as shown for approval: every change with the fact's text before and after. */
export type ProfileChangePayload = {
  baseVersion: number;
  reason: string;
  changes: (
    | { op: "add"; kind: ProfileFactKind; text: string }
    | {
        op: "modify";
        factId: string;
        before: { kind: ProfileFactKind; text: string };
        kind: ProfileFactKind;
        text: string;
      }
    | { op: "remove"; factId: string; before: { kind: ProfileFactKind; text: string } }
  )[];
};

export const APPROVAL_KINDS = ["profile_change"] as const;
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "superseded",
  "stale",
] as const;

/**
 * Profile changes: proposed by the copilot (pending until the user decides, bound to the chat
 * and the exact payload hash) or made by the user on the profile page (approved on insert).
 */
export const approvals = sqliteTable("app_approvals", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: APPROVAL_KINDS }).notNull(),
  status: text("status", { enum: APPROVAL_STATUSES }).notNull(),
  threadId: text("thread_id").notNull(),
  payload: text("payload", { mode: "json" }).$type<ProfileChangePayload>().notNull(),
  payloadHash: text("payload_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  /** Profile version created by an approved profile_change. */
  profileVersion: integer("profile_version"),
  createdAt: createdAt(),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

/** One row per approved profile change; the highest version is the current profile. */
export const profileVersions = sqliteTable("app_profile_versions", {
  version: integer("version").primaryKey(),
  approvalId: text("approval_id").notNull().unique(),
  createdAt: createdAt(),
});

/** Profile facts. A fact is current while `supersededInVersion` is null; history is kept. */
export const profileFacts = sqliteTable(
  "app_profile_facts",
  {
    id: text("id").primaryKey(),
    /** Short, permanent number shown to models as `f<handle>` (never reused); see factHandle. */
    handle: integer("handle").notNull().default(0),
    kind: text("kind", { enum: PROFILE_FACT_KINDS }).notNull(),
    text: text("text").notNull(),
    createdInVersion: integer("created_in_version").notNull(),
    supersededInVersion: integer("superseded_in_version"),
    /** The fact this one replaced (modify). */
    supersedesId: text("supersedes_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("app_profile_facts_current_idx").on(t.supersededInVersion),
    uniqueIndex("app_profile_facts_handle_idx").on(t.handle),
  ],
);

/** Researched claims, written one by one during a research run (partial results survive stops). */
export const claims = sqliteTable(
  "app_claims",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    threadId: text("thread_id"),
    topic: text("topic").$type<ResearchTopic>().notNull(),
    text: text("text").notNull(),
    evidence: text("evidence").$type<EvidenceClass>().notNull(),
    sourceIds: text("source_ids", { mode: "json" }).$type<string[]>().notNull(),
    quote: text("quote"),
    publishedAt: text("published_at"),
    eventDate: text("event_date"),
    createdAt: createdAt(),
  },
  (t) => [index("app_claims_job_idx").on(t.jobId)],
);

export const RUN_STATUSES = ["running", "completed", "cancelled", "failed", "interrupted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Chat runs (one per user turn). Maps a thread to its active durable run for reconnect/stop. */
export const runs = sqliteTable(
  "app_runs",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    status: text("status", { enum: RUN_STATUSES }).notNull(),
    error: text("error"),
    model: text("model"),
    traceId: text("trace_id"),
    /** Time to the first streamed text, ms. */
    ttftMs: integer("ttft_ms"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("app_runs_thread_idx").on(t.threadId, t.status)],
);

export const RUN_EVENT_TYPES = ["llm", "tool", "provider", "retry", "compaction", "error"] as const;
/** llm: model calls; search/extraction/browser: web providers; memory: compaction model. */
export const RUN_EVENT_CATEGORIES = [
  "llm",
  "search",
  "extraction",
  "browser",
  "memory",
  "app",
] as const;

/**
 * Everything a run did, one row per model call or provider call (so totals are sums and
 * nothing is counted twice), plus tool calls, retries, compaction and errors.
 */
export const runEvents = sqliteTable(
  "app_run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    type: text("type", { enum: RUN_EVENT_TYPES }).notNull(),
    category: text("category", { enum: RUN_EVENT_CATEGORIES }).notNull(),
    /** Tool name, model id or provider operation. */
    name: text("name").notNull(),
    /** Who made the call: copilot, researcher, rescorer, observer, ingest. */
    actor: text("actor"),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    /** Estimated cost from the static price table (USD). */
    estimatedUsd: real("estimated_usd"),
    /** Sanitized, size-limited details (args, query, URL, result summary). */
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("app_run_events_run_idx").on(t.runId)],
);

export type Job = typeof jobs.$inferSelect;
export type JobDraft = typeof jobDrafts.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type ProfileFact = typeof profileFacts.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type NewRunEvent = typeof runEvents.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];
