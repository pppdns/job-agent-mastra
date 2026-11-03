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

export type Job = typeof jobs.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];
