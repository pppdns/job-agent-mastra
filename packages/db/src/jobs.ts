import { createHash, randomUUID } from "node:crypto";
import {
  CLOSED_JOB_STATUSES,
  companyKey,
  type JobStatus,
  listingPostedDate,
  normalizeText,
} from "@copilot/shared";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { atsKey } from "./ats";
import type { Db } from "./index";
import {
  type Job,
  type JobOrigin,
  jobs,
  type Source,
  type SourceKind,
  type SourceProvider,
  sources,
} from "./schema";
import { canonicalWebUrl } from "./url";
import { serializeWrites } from "./write-lock";

export const MAX_SNAPSHOT_CHARS = 100_000;

/** "company key|normalized title", for listings without a stable id (also across boards). */
export const dedupeKey = (company: string, title: string) =>
  `${companyKey(company)}|${normalizeText(title)}`;

export type ListingIdentity = {
  linkedinJobId?: string | null;
  canonicalUrl?: string | null;
  /** Defaults to `atsKey(canonicalUrl)`. */
  atsKey?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  /** Only used when the job is created. */
  origin?: JobOrigin;
};

export type UpsertOptions = {
  /** false: matching an existing job doesn't bump its `updatedAt` (discovery re-sightings). */
  touch?: boolean;
};

/**
 * Finds the job for a listing or creates it. Match order: LinkedIn job id, ATS key (the same
 * ATS job under any URL form), canonical URL, then company + title, but only against a job
 * whose stable ids don't contradict ours.
 * Existing title/company are never overwritten; missing ids and location are filled in.
 */
export function upsertJob(
  db: Db,
  identity: ListingIdentity,
  options: UpsertOptions = {},
): Promise<{ job: Job; created: boolean }> {
  return serializeWrites(db, () => upsertJobUnlocked(db, identity, options));
}

/** Same as `upsertJob`, for callers already inside `serializeWrites` (not a transaction). */
export async function upsertJobUnlocked(
  db: Db,
  identity: ListingIdentity,
  options: UpsertOptions = {},
): Promise<{ job: Job; created: boolean }> {
  const key =
    identity.company && identity.title ? dedupeKey(identity.company, identity.title) : null;
  const ats = identity.atsKey ?? atsKey(identity.canonicalUrl);

  return db.transaction(async (tx) => {
    const byId = identity.linkedinJobId
      ? await tx.query.jobs.findFirst({ where: eq(jobs.linkedinJobId, identity.linkedinJobId) })
      : undefined;
    const byAts = ats ? await tx.query.jobs.findFirst({ where: eq(jobs.atsKey, ats) }) : undefined;
    const byUrl =
      !byId && !byAts && identity.canonicalUrl
        ? await tx.query.jobs.findFirst({ where: eq(jobs.canonicalUrl, identity.canonicalUrl) })
        : undefined;
    const byKey =
      !byId && !byAts && !byUrl && key
        ? (await tx.query.jobs.findMany({ where: eq(jobs.dedupeKey, key) })).find(
            (job) =>
              compatible(job.linkedinJobId, identity.linkedinJobId) &&
              compatible(job.atsKey, ats) &&
              compatible(job.canonicalUrl, identity.canonicalUrl),
          )
        : undefined;
    const existing = byId ?? byAts ?? byUrl ?? byKey;
    const now = new Date();

    if (existing) {
      const [job] = await tx
        .update(jobs)
        .set({
          linkedinJobId: existing.linkedinJobId ?? identity.linkedinJobId ?? null,
          canonicalUrl: existing.canonicalUrl ?? identity.canonicalUrl ?? null,
          // Never take a key another job holds (matched by LinkedIn id, but on another ATS job).
          atsKey: existing.atsKey ?? (byAts && byAts.id !== existing.id ? null : ats),
          company: existing.company ?? identity.company ?? null,
          title: existing.title ?? identity.title ?? null,
          location: existing.location ?? identity.location ?? null,
          dedupeKey: existing.dedupeKey ?? key,
          companyKey:
            existing.companyKey ?? (identity.company ? companyKey(identity.company) : null),
          ...(options.touch === false ? {} : { updatedAt: now }),
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
        atsKey: ats,
        company: identity.company ?? null,
        title: identity.title ?? null,
        location: identity.location ?? null,
        dedupeKey: key,
        companyKey: identity.company ? companyKey(identity.company) : null,
        origin: identity.origin ?? "chat",
        updatedAt: now,
      })
      .returning();
    if (!job) throw new Error("job insert returned no row");
    await reindexJob(tx, job.id);
    return { job, created: true };
  });
}

/**
 * The saved job behind a listing URL, without fetching it: by LinkedIn job id, the job's
 * canonical URL, or a listing snapshot (LinkedIn or employer posting) read from that URL.
 * URLs compare without tracking parameters or fragment, also for snapshots stored with them.
 * Research pages (`web` sources) never count, so a company page is never taken for a job.
 */
export async function findJobByUrl(
  db: Db,
  input: { linkedinJobId?: string | null; urls: string[] },
): Promise<Job | undefined> {
  if (input.linkedinJobId) {
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.linkedinJobId, input.linkedinJobId),
    });
    if (job) return job;
  }
  const keys = [...new Set(input.urls.flatMap((u) => atsKey(u) ?? []))];
  if (keys.length > 0) {
    const byAts = await db.query.jobs.findFirst({ where: inArray(jobs.atsKey, keys) });
    if (byAts) return byAts;
  }
  const wanted = new Set(input.urls.flatMap((u) => canonicalOrNull(u) ?? []));
  if (wanted.size === 0) return undefined;
  const byUrl = await db.query.jobs.findFirst({
    where: inArray(jobs.canonicalUrl, [...wanted]),
  });
  if (byUrl) return byUrl;
  // Stored snapshot URLs may still carry tracking parameters: fetch same-path candidates,
  // then compare canonical forms.
  const paths = [...wanted].map((u) => u.split(/[?#]/)[0] ?? u);
  const candidates = await db.query.sources.findMany({
    where: and(
      inArray(sources.kind, ["linkedin", "ats", "board"]),
      or(
        ...paths.flatMap((p) => [
          eq(sources.url, p),
          like(sources.url, `${p}?%`),
          like(sources.url, `${p}#%`),
        ]),
      ),
    ),
    orderBy: desc(sources.retrievedAt),
  });
  const source = candidates.find((s) => s.url && wanted.has(canonicalOrNull(s.url) ?? ""));
  return source ? db.query.jobs.findFirst({ where: eq(jobs.id, source.jobId) }) : undefined;
}

const canonicalOrNull = (url: string) => {
  try {
    return canonicalWebUrl(new URL(url));
  } catch {
    return null;
  }
};

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

/** Same as `addSource`, for callers already inside `serializeWrites`. */
export async function addSourceUnlocked(
  db: Db,
  input: NewSource,
): Promise<{ source: Source; created: boolean }> {
  const truncated = input.content.length > MAX_SNAPSHOT_CHARS;
  const content = truncated ? input.content.slice(0, MAX_SNAPSHOT_CHARS) : input.content;
  const contentHash = createHash("sha256").update(content).digest("hex");
  const retrievedAt = input.retrievedAt ?? new Date();

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
      retrievedAt,
      ...postedColumns(input.kind, content, retrievedAt),
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

function postedColumns(kind: string, content: string, retrievedAt: Date) {
  const posted = listingPostedDate(kind, content, retrievedAt);
  return { postedAt: posted?.postedAt ?? null, postedBasis: posted?.basis ?? ("none" as const) };
}

/**
 * Parses the posting date of sources saved before it was stored (`posted_basis` null). Runs from
 * `migrateDb`; once every row is parsed it matches nothing.
 */
export function backfillPostedDates(db: Db): Promise<number> {
  return serializeWrites(db, async () => {
    const rows = await db
      .select({
        id: sources.id,
        kind: sources.kind,
        content: sources.content,
        retrievedAt: sources.retrievedAt,
      })
      .from(sources)
      .where(isNull(sources.postedBasis));
    if (rows.length === 0) return 0;
    await db.transaction(async (tx) => {
      for (const row of rows) {
        await tx
          .update(sources)
          .set(postedColumns(row.kind, row.content, row.retrievedAt))
          .where(eq(sources.id, row.id));
      }
    });
    return rows.length;
  });
}

/**
 * Fills `company_key` (and recomputes `dedupe_key` with it) for jobs saved before company keys
 * existed. Runs from `migrateDb`; once every job with a company has a key it matches nothing.
 */
export function backfillCompanyKeys(db: Db): Promise<number> {
  return serializeWrites(db, async () => {
    const rows = await db
      .select({ id: jobs.id, company: jobs.company, title: jobs.title })
      .from(jobs)
      .where(and(isNull(jobs.companyKey), sql`${jobs.company} IS NOT NULL`));
    if (rows.length === 0) return 0;
    await db.transaction(async (tx) => {
      for (const row of rows) {
        if (!row.company) continue;
        await tx
          .update(jobs)
          .set({
            companyKey: companyKey(row.company),
            ...(row.title ? { dedupeKey: dedupeKey(row.company, row.title) } : {}),
          })
          .where(eq(jobs.id, row.id));
      }
    });
    return rows.length;
  });
}

/**
 * Fills `ats_key` from the canonical URL for jobs saved before ATS keys existed, skipping a key
 * another job already holds. Runs from `migrateDb`; afterwards only rows without an ATS URL
 * match, and those get nothing.
 */
export function backfillAtsKeys(db: Db): Promise<number> {
  return serializeWrites(db, async () => {
    const rows = await db
      .select({ id: jobs.id, canonicalUrl: jobs.canonicalUrl })
      .from(jobs)
      .where(and(isNull(jobs.atsKey), sql`${jobs.canonicalUrl} IS NOT NULL`));
    const taken = new Set(
      (
        await db.select({ atsKey: jobs.atsKey }).from(jobs).where(sql`${jobs.atsKey} IS NOT NULL`)
      ).map((r) => r.atsKey),
    );
    let filled = 0;
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const key = atsKey(row.canonicalUrl);
        if (!key || taken.has(key)) continue;
        taken.add(key);
        await tx.update(jobs).set({ atsKey: key }).where(eq(jobs.id, row.id));
        filled += 1;
      }
    });
    return filled;
  });
}

/**
 * Whether a source is a read of the job's listing. Research also stores the pages it reads as
 * `web` sources, so a `web` source only counts when it is the job's own URL.
 */
export const isListingSource = (
  source: Pick<Source, "kind" | "url">,
  canonicalUrl: string | null,
) => source.kind !== "web" || (source.url !== null && source.url === canonicalUrl);

/**
 * The most recently read listing of a job (see `isListingSource`), with its stored content.
 */
export async function latestListingSource(db: Db, jobId: string): Promise<Source | undefined> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return undefined;
  const rows = await db.query.sources.findMany({
    where: eq(sources.jobId, jobId),
    orderBy: desc(sources.retrievedAt),
  });
  return rows.find((s) => isListingSource(s, job.canonicalUrl));
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
