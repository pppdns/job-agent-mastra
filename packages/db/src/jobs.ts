import { createHash, randomUUID } from "node:crypto";
import { CLOSED_JOB_STATUSES, type JobStatus } from "@copilot/shared";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
  type Job,
  jobs,
  type Source,
  type SourceKind,
  type SourceProvider,
  sources,
} from "./schema";
import { serializeWrites } from "./write-lock";

export const MAX_SNAPSHOT_CHARS = 100_000;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Normalized "company|title", for listings without a stable id. */
export const dedupeKey = (company: string, title: string) =>
  `${normalize(company)}|${normalize(title)}`;

export type ListingIdentity = {
  linkedinJobId?: string | null;
  canonicalUrl?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
};

/**
 * Finds the job for a listing or creates it. Match order: LinkedIn job id, canonical URL,
 * then company + title, but only against a job whose stable ids don't contradict ours.
 * Existing title/company are never overwritten; missing ids and location are filled in.
 */
export function upsertJob(
  db: Db,
  identity: ListingIdentity,
): Promise<{ job: Job; created: boolean }> {
  return serializeWrites(db, () => upsertJobUnlocked(db, identity));
}

async function upsertJobUnlocked(
  db: Db,
  identity: ListingIdentity,
): Promise<{ job: Job; created: boolean }> {
  const key =
    identity.company && identity.title ? dedupeKey(identity.company, identity.title) : null;

  return db.transaction(async (tx) => {
    const byId = identity.linkedinJobId
      ? await tx.query.jobs.findFirst({ where: eq(jobs.linkedinJobId, identity.linkedinJobId) })
      : undefined;
    const byUrl =
      !byId && identity.canonicalUrl
        ? await tx.query.jobs.findFirst({ where: eq(jobs.canonicalUrl, identity.canonicalUrl) })
        : undefined;
    const byKey =
      !byId && !byUrl && key
        ? (await tx.query.jobs.findMany({ where: eq(jobs.dedupeKey, key) })).find(
            (job) =>
              compatible(job.linkedinJobId, identity.linkedinJobId) &&
              compatible(job.canonicalUrl, identity.canonicalUrl),
          )
        : undefined;
    const existing = byId ?? byUrl ?? byKey;
    const now = new Date();

    if (existing) {
      const [job] = await tx
        .update(jobs)
        .set({
          linkedinJobId: existing.linkedinJobId ?? identity.linkedinJobId ?? null,
          canonicalUrl: existing.canonicalUrl ?? identity.canonicalUrl ?? null,
          company: existing.company ?? identity.company ?? null,
          title: existing.title ?? identity.title ?? null,
          location: existing.location ?? identity.location ?? null,
          dedupeKey: existing.dedupeKey ?? key,
          updatedAt: now,
        })
        .where(eq(jobs.id, existing.id))
        .returning();
      if (!job) throw new Error("job update returned no row");
      await reindexJob(tx, job.id);
      return { job, created: false };
    }

    const [job] = await tx
      .insert(jobs)
      .values({
        id: randomUUID(),
        linkedinJobId: identity.linkedinJobId ?? null,
        canonicalUrl: identity.canonicalUrl ?? null,
        company: identity.company ?? null,
        title: identity.title ?? null,
        location: identity.location ?? null,
        dedupeKey: key,
        updatedAt: now,
      })
      .returning();
    if (!job) throw new Error("job insert returned no row");
    await reindexJob(tx, job.id);
    return { job, created: true };
  });
}

const compatible = (stored: string | null, incoming: string | null | undefined) =>
  !stored || !incoming || stored === incoming;

export type NewSource = {
  jobId: string;
  kind: SourceKind;
  provider: SourceProvider;
  url?: string | null;
  content: string;
  threadId?: string | null;
  retrievedAt?: Date;
};

/** Stores a bounded snapshot. Re-reading identical content for the same job returns the existing row. */
export function addSource(db: Db, input: NewSource): Promise<{ source: Source; created: boolean }> {
  return serializeWrites(db, () => addSourceUnlocked(db, input));
}

async function addSourceUnlocked(
  db: Db,
  input: NewSource,
): Promise<{ source: Source; created: boolean }> {
  const truncated = input.content.length > MAX_SNAPSHOT_CHARS;
  const content = truncated ? input.content.slice(0, MAX_SNAPSHOT_CHARS) : input.content;
  const contentHash = createHash("sha256").update(content).digest("hex");

  const [inserted] = await db
    .insert(sources)
    .values({
      id: randomUUID(),
      jobId: input.jobId,
      kind: input.kind,
      provider: input.provider,
      url: input.url ?? null,
      content,
      contentHash,
      truncated,
      threadId: input.threadId ?? null,
      retrievedAt: input.retrievedAt ?? new Date(),
    })
    .onConflictDoNothing({ target: [sources.jobId, sources.contentHash] })
    .returning();
  if (inserted) return { source: inserted, created: true };

  const existing = await db.query.sources.findFirst({
    where: (s, { and }) => and(eq(s.jobId, input.jobId), eq(s.contentHash, contentHash)),
  });
  if (!existing) throw new Error("source conflict without an existing row");
  return { source: existing, created: false };
}

/**
 * The most recently read listing of a job, with its stored content. Research also stores the
 * pages it reads as `web` sources, so a `web` source only counts when it is the job's own URL.
 */
export async function latestListingSource(db: Db, jobId: string): Promise<Source | undefined> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return undefined;
  const rows = await db.query.sources.findMany({
    where: eq(sources.jobId, jobId),
    orderBy: desc(sources.retrievedAt),
  });
  return rows.find((s) => s.kind !== "web" || (s.url !== null && s.url === job.canonicalUrl));
}

type Writer = Pick<Db, "run">;

/** Rebuilds a job's full-text row from its identity and latest draft overview. */
export async function reindexJob(db: Writer, jobId: string): Promise<void> {
  await db.run(sql`DELETE FROM app_jobs_fts WHERE job_id = ${jobId}`);
  await db.run(sql`
    INSERT INTO app_jobs_fts (job_id, title, company, location, summary)
    SELECT j.id, coalesce(j.title, ''), coalesce(j.company, ''), coalesce(j.location, ''),
      coalesce((SELECT json_extract(d.assessment, '$.overview') FROM app_job_drafts d
                WHERE d.job_id = j.id ORDER BY d.version DESC LIMIT 1), '')
    FROM app_jobs j WHERE j.id = ${jobId}`);
}

/** Turns free text into an FTS5 query of quoted prefix terms (no operators from the caller). */
export function ftsQuery(text: string, join: "AND" | "OR"): string | null {
  const terms = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return terms.length > 0 ? terms.map((t) => `"${t}"*`).join(` ${join} `) : null;
}

/**
 * Saved jobs matching free text (title, company, location, latest overview). All words must
 * match; if nothing does, any word may. Returns at most `limit` job ids, best first.
 */
export async function searchJobIds(db: Db, text: string, limit = 5): Promise<string[]> {
  for (const join of ["AND", "OR"] as const) {
    const query = ftsQuery(text, join);
    if (!query) return [];
    const rows = await db.all<{ job_id: string }>(
      sql`SELECT job_id FROM app_jobs_fts WHERE app_jobs_fts MATCH ${query} ORDER BY rank LIMIT ${limit}`,
    );
    if (rows.length > 0) return rows.map((r) => r.job_id);
  }
  return [];
}

/**
 * Sets the user's pipeline status. Closing statuses (rejected, dismissed) archive the job;
 * moving back to an open status unarchives it. Setting the current status again is a no-op.
 * Drafts, snapshots and approvals are untouched. Returns undefined for an unknown job.
 */
export function setJobStatus(db: Db, jobId: string, status: JobStatus): Promise<Job | undefined> {
  return serializeWrites(db, async () => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job || job.status === status) return job;
    const now = new Date();
    const [updated] = await db
      .update(jobs)
      .set({
        status,
        statusChangedAt: now,
        archivedAt: CLOSED_JOB_STATUSES.includes(status) ? (job.archivedAt ?? now) : null,
      })
      .where(eq(jobs.id, jobId))
      .returning();
    return updated;
  });
}

/** Archives or unarchives a job without changing its status. Undefined for an unknown job. */
export function setJobArchived(db: Db, jobId: string, archived: boolean): Promise<Job | undefined> {
  return serializeWrites(db, async () => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job || (job.archivedAt !== null) === archived) return job;
    const [updated] = await db
      .update(jobs)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(jobs.id, jobId))
      .returning();
    return updated;
  });
}
