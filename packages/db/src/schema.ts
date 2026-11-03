import type { Assessment } from "@copilot/shared";
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
  assessment: Assessment;
};

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

export const APPROVAL_KINDS = ["job_snapshot"] as const;
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
  payload: text("payload", { mode: "json" }).$type<SnapshotPayload>().notNull(),
  payloadHash: text("payload_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  snapshotId: text("snapshot_id"),
  createdAt: createdAt(),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

export type Job = typeof jobs.$inferSelect;
export type JobDraft = typeof jobDrafts.$inferSelect;
export type JobSnapshot = typeof jobSnapshots.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type Source = typeof sources.$inferSelect;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];
