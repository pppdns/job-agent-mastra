import { randomUUID } from "node:crypto";
import {
  type AssessmentSummary,
  allPoints,
  assessmentSchema,
  assessmentSummary,
  type JobStatus,
  moneyAmounts,
  type PostedBasis,
  SOURCED_EVIDENCE_CLASSES,
  salaryFiguresMissing,
} from "@copilot/shared";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { getSearchSettings, visibleJobs } from "./discovery";
import { AssessmentError } from "./hash";
import type { Db } from "./index";
import { isListingSource, reindexJob } from "./jobs";
import { currentProfile, currentProfileVersion, resolveFactRef, unknownFactHint } from "./profile";
import { claims, type JobDraft, type JobOrigin, jobDrafts, jobs, sources } from "./schema";
import { serializeWrites } from "./write-lock";

/**
 * Saves the next assessment version for a job (no approval: the latest version is current). Evidence must cite sources stored for that job,
 * and sourced evidence classes must cite at least one. Points citing profile facts must be
 * inference, cite current facts, and appear only (and at least once) in with_profile drafts.
 * Every figure in `salary` must appear in one of the job's sources.
 */
export function saveDraft(db: Db, input: DraftInput): Promise<JobDraft> {
  return serializeWrites(db, () => saveDraftUnlocked(db, input));
}

export type DraftInput = {
  jobId: string;
  assessment: unknown;
  threadId?: string | null;
  /** The profile version the assessment was made against; rejected if the profile moved since. */
  profileVersion?: number;
};

async function saveDraftUnlocked(db: Db, input: DraftInput): Promise<JobDraft> {
  const parsed = assessmentSchema.safeParse(input.assessment);
  if (!parsed.success) throw new AssessmentError(`invalid assessment: ${parsed.error.message}`);
  const assessment = parsed.data;
  if (assessment.fitBasis === "role_only" && assessment.fitLevel) {
    throw new AssessmentError("fitLevel needs fitBasis with_profile; omit it for role_only");
  }
  if (assessment.fitBasis === "with_profile" && !assessment.fitLevel) {
    throw new AssessmentError("fitBasis with_profile needs a fitLevel");
  }

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, input.jobId) });
  if (!job) throw new AssessmentError(`unknown job id ${input.jobId}`);

  const jobSources = await db
    .select({ id: sources.id, content: sources.content })
    .from(sources)
    .where(eq(sources.jobId, job.id));
  const known = new Set(jobSources.map((s) => s.id));
  // Pay is a listing fact: every figure must come from a stored source, never an estimate.
  if (assessment.salary) {
    if (moneyAmounts(assessment.salary).length === 0) {
      throw new AssessmentError(
        `salary "${assessment.salary.slice(0, 40)}" states no figure; omit salary unless the listing gives an amount`,
      );
    }
    const missing = salaryFiguresMissing(
      assessment.salary,
      jobSources.map((s) => s.content),
    );
    if (missing.length > 0) {
      throw new AssessmentError(
        `salary figures ${missing.join(", ")} are not in this job's sources; copy the pay as the listing states it, or omit salary when none is stated`,
      );
    }
  }
  // Fit points (comparisons with the profile) are the model's judgement: deterministic labels.
  // Models cite handles (f7, maybe as "fact:f7"); store the full ids of current facts.
  const currentFacts = (await currentProfile(db)).facts;
  for (const point of allPoints(assessment)) {
    point.profileFactIds = point.profileFactIds.map((ref) => {
      const fact = resolveFactRef(ref, currentFacts);
      if (!fact) {
        throw new AssessmentError(
          `profile fact ${ref} is not in the approved profile${unknownFactHint(currentFacts)}`,
        );
      }
      return fact.id;
    });
  }
  const fitPoints = allPoints(assessment).filter((p) => p.profileFactIds.length > 0);
  if (assessment.fitBasis === "role_only" && fitPoints.length > 0) {
    throw new AssessmentError("role_only drafts can't cite profileFactIds; judge fit with_profile");
  }
  if (assessment.fitBasis === "with_profile" && fitPoints.length === 0) {
    throw new AssessmentError(
      "with_profile drafts need at least one point that cites the profile facts it compares against (profileFactIds)",
    );
  }
  for (const point of fitPoints) {
    if (point.evidence !== "inference") {
      throw new AssessmentError(
        `"${point.text.slice(0, 60)}" compares the job with the profile, so its evidence is inference ` +
          "(keep the listing sourceIds and quote); state listing facts as separate official points",
      );
    }
  }
  for (const point of allPoints(assessment)) {
    const unknown = point.sourceIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new AssessmentError(
        `source ids ${unknown.join(", ")} are not sources of this job; cite the sourceIds from ingest_listing or research_company (a research claimId is not a source id)`,
      );
    }
    if (SOURCED_EVIDENCE_CLASSES.includes(point.evidence) && point.sourceIds.length === 0) {
      throw new AssessmentError(
        `"${point.text.slice(0, 60)}" is marked ${point.evidence} but cites no source; ` +
          "cite a source id or mark it inference / unknown_conflicting",
      );
    }
  }

  return db.transaction(async (tx) => {
    const profileVersion = await currentProfileVersion(tx);
    if (input.profileVersion !== undefined && input.profileVersion !== profileVersion) {
      throw new AssessmentError(
        `the profile changed (v${input.profileVersion} → v${profileVersion}) during the assessment`,
      );
    }
    const [row] = await tx
      .select({ latest: max(jobDrafts.version) })
      .from(jobDrafts)
      .where(eq(jobDrafts.jobId, job.id));
    const [draft] = await tx
      .insert(jobDrafts)
      .values({
        id: randomUUID(),
        jobId: job.id,
        version: (row?.latest ?? 0) + 1,
        assessment,
        // Recorded by app code, not the model: the approved profile at save time.
        profileVersion,
        threadId: input.threadId ?? null,
      })
      .returning();
    await tx.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, job.id));
    await reindexJob(tx, job.id);
    if (!draft) throw new Error("draft insert returned no row");
    return draft;
  });
}

export async function latestDraft(db: Db, jobId: string): Promise<JobDraft | undefined> {
  return db.query.jobDrafts.findFirst({
    where: eq(jobDrafts.jobId, jobId),
    orderBy: desc(jobDrafts.version),
  });
}

export type JobOverview = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  status: JobStatus;
  statusChangedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** When the company posted the job, from the latest listing snapshot that states it. */
  postedAt: Date | null;
  postedBasis: PostedBasis | null;
  /** Latest assessment version (null before the first assessment). */
  draftVersion: number | null;
  /** Profile version the latest draft used; compare with the current one for staleness. */
  draftProfileVersion: number | null;
  /** True when the latest draft was written against an older approved profile. */
  profileStale: boolean;
  /** Verdict, fit and counts of the latest draft. */
  summary: AssessmentSummary | null;
  origin: JobOrigin;
  triageScore: number | null;
};

export type ListJobsOptions = {
  /** Also return discovered jobs the screen or triage hides (see `visibleJobs`). */
  includeHidden?: boolean;
};

/**
 * Jobs with their latest assessment version, newest first (optionally only `ids`). Discovered
 * jobs the screen or triage threshold hides are left out unless `includeHidden`.
 */
export async function listJobs(
  db: Db,
  ids?: string[],
  options: ListJobsOptions = {},
): Promise<JobOverview[]> {
  if (ids?.length === 0) return [];
  const [profileVersion, settings] = await Promise.all([
    currentProfileVersion(db),
    getSearchSettings(db),
  ]);
  const query = db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      status: jobs.status,
      statusChangedAt: jobs.statusChangedAt,
      archivedAt: jobs.archivedAt,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      origin: jobs.origin,
      triageScore: jobs.triageScore,
      draftVersion: sql<
        number | null
      >`(select max(version) from app_job_drafts d where d.job_id = "app_jobs"."id")`,
      draftProfileVersion: sql<
        number | null
      >`(select d.profile_version from app_job_drafts d where d.job_id = "app_jobs"."id" order by d.version desc limit 1)`,
      draftAssessment: sql<
        string | null
      >`(select d.assessment from app_job_drafts d where d.job_id = "app_jobs"."id" order by d.version desc limit 1)`,
      // Latest dated listing source; same rule as isListingSource.
      postedAtMs: sql<number | null>`(select s.posted_at from app_sources s ${datedListingSource})`,
      postedBasis: sql<PostedBasis | null>`(select s.posted_basis from app_sources s ${datedListingSource})`,
    })
    .from(jobs);
  const visible = options.includeHidden ? undefined : visibleJobs(settings.triageThreshold);
  const rows = await query
    .where(and(ids ? inArray(jobs.id, ids) : undefined, visible))
    .orderBy(desc(jobs.updatedAt));
  const overviews = rows.map(({ draftAssessment, postedAtMs, ...row }) => ({
    ...row,
    postedAt: postedAtMs === null ? null : new Date(postedAtMs),
    summary: summaryOf(draftAssessment),
    profileStale: row.draftProfileVersion !== null && row.draftProfileVersion !== profileVersion,
  }));
  // Keep search ranking when ids are given.
  return ids ? ids.flatMap((id) => overviews.filter((o) => o.id === id)) : overviews;
}

const datedListingSource = sql`where s.job_id = "app_jobs"."id" and s.posted_at is not null
  and (s.kind != 'web' or s.url = "app_jobs"."canonical_url")
  order by s.retrieved_at desc limit 1`;

/** At-a-glance summary of a stored draft; null when there is none or it no longer parses. */
function summaryOf(json: string | null): AssessmentSummary | null {
  if (!json) return null;
  const parsed = assessmentSchema.safeParse(JSON.parse(json));
  return parsed.success ? assessmentSummary(parsed.data) : null;
}

/** A job with its sources (metadata only), claims and every assessment version, newest first. */
export async function getJobDetail(db: Db, jobId: string) {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return undefined;
  const [jobSources, drafts, profileVersion, jobClaims] = await Promise.all([
    db
      .select({
        id: sources.id,
        kind: sources.kind,
        provider: sources.provider,
        url: sources.url,
        truncated: sources.truncated,
        retrievedAt: sources.retrievedAt,
        postedAt: sources.postedAt,
        postedBasis: sources.postedBasis,
      })
      .from(sources)
      .where(eq(sources.jobId, jobId))
      .orderBy(desc(sources.retrievedAt)),
    db.query.jobDrafts.findMany({
      where: eq(jobDrafts.jobId, jobId),
      orderBy: desc(jobDrafts.version),
    }),
    currentProfileVersion(db),
    db.query.claims.findMany({ where: eq(claims.jobId, jobId), orderBy: desc(claims.createdAt) }),
  ]);
  const [draft, ...history] = drafts;
  const dated = jobSources.find((s) => s.postedAt && isListingSource(s, job.canonicalUrl));
  return {
    job,
    /** When the company posted the job, from the latest listing snapshot that states it. */
    posted:
      dated?.postedAt && dated.postedBasis && dated.postedBasis !== "none"
        ? { at: dated.postedAt, basis: dated.postedBasis }
        : null,
    claims: jobClaims,
    sources: jobSources,
    /** The current assessment. */
    draft,
    /** Earlier assessment versions. */
    history,
    profileVersion,
    profileStale: draft !== undefined && draft.profileVersion !== profileVersion,
  };
}
