import type { Assessment, EvidenceClass, ProfileFactKind, ResearchTopic } from "@copilot/shared";
import { PROFILE_FACT_KINDS } from "@copilot/shared";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("app_jobs_dedupe_key_idx").on(t.dedupeKey)],
);

export const SOURCE_KINDS = ["linkedin", "ats", "web", "pasted"] as const;
export const SOURCE_PROVIDERS = ["tavily", "firecrawl", "user"] as const;

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

/** Exactly what a job snapshot approval would save (and what its hash covers). */
export type SnapshotPayload = {
  job: {
    title: string | null;
    company: string | null;
    location: string | null;
    linkedinJobId: string | null;
    canonicalUrl: string | null;
  };
  draftId: string;
  draftVersion: number;
  profileVersion: number;
  assessment: Assessment;
};

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

export type ApprovalPayload = SnapshotPayload | ProfileChangePayload;

/** Approved job snapshots. Insert-only: each approval adds the next version. */
export const jobSnapshots = sqliteTable(
  "app_job_snapshots",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    draftId: text("draft_id")
      .notNull()
      .references(() => jobDrafts.id),
    payload: text("payload", { mode: "json" }).$type<SnapshotPayload>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    approvalId: text("approval_id").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("app_job_snapshots_job_version_uq").on(t.jobId, t.version)],
);

export const APPROVAL_KINDS = ["job_snapshot", "profile_change"] as const;
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "superseded",
  "stale",
] as const;

/**
 * Proposed durable changes awaiting the user. Bound to the chat that proposed them, the
 * exact payload (hash) and the draft version, so stale or cross-chat decisions fail.
 */
export const approvals = sqliteTable("app_approvals", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: APPROVAL_KINDS }).notNull(),
  status: text("status", { enum: APPROVAL_STATUSES }).notNull(),
  threadId: text("thread_id").notNull(),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  draftId: text("draft_id").references(() => jobDrafts.id),
  draftVersion: integer("draft_version"),
  /** SnapshotPayload for job_snapshot, ProfileChangePayload for profile_change. */
  payload: text("payload", { mode: "json" }).$type<ApprovalPayload>().notNull(),
  payloadHash: text("payload_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  snapshotId: text("snapshot_id"),
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
    kind: text("kind", { enum: PROFILE_FACT_KINDS }).notNull(),
    text: text("text").notNull(),
    createdInVersion: integer("created_in_version").notNull(),
    supersededInVersion: integer("superseded_in_version"),
    /** The fact this one replaced (modify). */
    supersedesId: text("supersedes_id"),
    createdAt: createdAt(),
  },
  (t) => [index("app_profile_facts_current_idx").on(t.supersededInVersion)],
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
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("app_runs_thread_idx").on(t.threadId, t.status)],
);

export type Job = typeof jobs.$inferSelect;
export type JobDraft = typeof jobDrafts.$inferSelect;
export type JobSnapshot = typeof jobSnapshots.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type ProfileFact = typeof profileFacts.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];
