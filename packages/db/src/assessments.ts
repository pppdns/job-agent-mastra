import { randomUUID } from "node:crypto";
import {
  type AssessmentSummary,
  allPoints,
  assessmentSchema,
  assessmentSummary,
  SOURCED_EVIDENCE_CLASSES,
} from "@copilot/shared";
import { and, desc, eq, inArray, max, sql, TransactionRollbackError } from "drizzle-orm";
import { AssessmentError, hashPayload } from "./hash";
import type { Db } from "./index";
import { reindexJob } from "./jobs";
import { applyProfileChange, currentProfileVersion } from "./profile";
import {
  type Approval,
  approvals,
  claims,
  type JobDraft,
  type JobSnapshot,
  jobDrafts,
  jobSnapshots,
  jobs,
  type ProfileChangePayload,
  type SnapshotPayload,
  sources,
} from "./schema";
import { serializeWrites } from "./write-lock";

/** The snapshot payload of a job_snapshot approval. */
export function snapshotPayloadOf(approval: Approval): SnapshotPayload {
  if (approval.kind !== "job_snapshot")
    throw new Error(`approval ${approval.id} is not a snapshot`);
  return approval.payload as SnapshotPayload;
}

/**
 * Saves the next draft version for a job. Evidence must cite sources stored for that job,
 * and sourced evidence classes must cite at least one.
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

  const known = new Set(
    (await db.select({ id: sources.id }).from(sources).where(eq(sources.jobId, job.id))).map(
      (s) => s.id,
    ),
  );
  for (const point of allPoints(assessment)) {
    const unknown = point.sourceIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new AssessmentError(
        `source ids ${unknown.join(", ")} are not sources of this job; use ids from ingest_listing`,
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

/**
 * Proposes the job's latest draft as an approved snapshot. Idempotent per draft and chat;
 * older pending proposals for the job are superseded. Never approves anything itself.
 */
export function proposeSnapshot(
  db: Db,
  input: { jobId: string; threadId: string },
): Promise<{ approval: Approval; created: boolean }> {
  return serializeWrites(db, () => proposeSnapshotUnlocked(db, input));
}

async function proposeSnapshotUnlocked(
  db: Db,
  input: { jobId: string; threadId: string },
): Promise<{ approval: Approval; created: boolean }> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, input.jobId) });
  if (!job) throw new AssessmentError(`unknown job id ${input.jobId}`);
  const draft = await latestDraft(db, job.id);
  if (!draft) throw new AssessmentError("this job has no draft yet; call save_job_draft first");

  const idempotencyKey = `job_snapshot:${draft.id}:${input.threadId}`;
  const existing = await db.query.approvals.findFirst({
    where: eq(approvals.idempotencyKey, idempotencyKey),
  });
  if (existing) return { approval: existing, created: false };

  const payload: SnapshotPayload = {
    job: {
      title: job.title,
      company: job.company,
      location: job.location,
      linkedinJobId: job.linkedinJobId,
      canonicalUrl: job.canonicalUrl,
    },
    draftId: draft.id,
    draftVersion: draft.version,
    profileVersion: draft.profileVersion,
    assessment: draft.assessment,
  };

  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(approvals)
      .set({ status: "superseded", resolvedAt: now })
      .where(
        and(
          eq(approvals.jobId, job.id),
          eq(approvals.kind, "job_snapshot"),
          eq(approvals.status, "pending"),
        ),
      );
    const [approval] = await tx
      .insert(approvals)
      .values({
        id: randomUUID(),
        kind: "job_snapshot",
        status: "pending",
        threadId: input.threadId,
        jobId: job.id,
        draftId: draft.id,
        draftVersion: draft.version,
        payload,
        payloadHash: hashPayload(payload),
        idempotencyKey,
      })
      .returning();
    if (!approval) throw new Error("approval insert returned no row");
    return { approval, created: true };
  });
}

export type DecisionError =
  | "not_found"
  | "wrong_thread"
  | "stale"
  | "superseded"
  | "already_resolved";

export type DecisionResult =
  | { ok: true; approval: Approval; snapshot?: JobSnapshot }
  | { ok: false; error: DecisionError; approval?: Approval };

/**
 * Applies the user's decision. Only the user (via the web app) calls this, never a tool.
 * Rejects decisions from another chat, for a changed payload, or for an outdated draft.
 * Repeating a decision that already succeeded returns the same result (lost-response retry).
 */
export type DecisionInput = {
  approvalId: string;
  threadId: string;
  decision: "approve" | "reject";
  payloadHash: string;
};

export function decideApproval(db: Db, input: DecisionInput): Promise<DecisionResult> {
  return serializeWrites(db, () => decideApprovalUnlocked(db, input));
}

async function decideApprovalUnlocked(db: Db, input: DecisionInput): Promise<DecisionResult> {
  const approval = await db.query.approvals.findFirst({
    where: eq(approvals.id, input.approvalId),
  });
  if (!approval) return { ok: false, error: "not_found" };
  if (approval.threadId !== input.threadId) return { ok: false, error: "wrong_thread" };

  const wanted = input.decision === "approve" ? "approved" : "rejected";
  if (approval.status !== "pending") return settled(db, approval, wanted);
  if (approval.payloadHash !== input.payloadHash) return { ok: false, error: "stale", approval };

  if (input.decision === "reject") {
    const updated = await transition(db, approval.id, { status: "rejected" });
    return updated ? { ok: true, approval: updated } : retry(db, approval.id, wanted);
  }

  if (approval.kind === "profile_change") return approveProfileChange(db, approval, wanted);

  const draft = approval.jobId ? await latestDraft(db, approval.jobId) : undefined;
  if (!draft || draft.version !== approval.draftVersion || !approval.jobId || !approval.draftId) {
    const updated = await transition(db, approval.id, { status: "stale" });
    return { ok: false, error: "stale", approval: updated ?? approval };
  }
  const jobId = approval.jobId;
  const draftId = approval.draftId;

  return db.transaction(async (tx) => {
    // Conditional update: only one concurrent approval of this row can win.
    const [won] = await tx
      .update(approvals)
      .set({ status: "approved", resolvedAt: new Date() })
      .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
      .returning();
    if (!won) {
      const current = await tx.query.approvals.findFirst({ where: eq(approvals.id, approval.id) });
      return current ? settled(tx, current, wanted) : { ok: false, error: "not_found" };
    }
    const [row] = await tx
      .select({ latest: max(jobSnapshots.version) })
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, jobId));
    const [snapshot] = await tx
      .insert(jobSnapshots)
      .values({
        id: randomUUID(),
        jobId,
        version: (row?.latest ?? 0) + 1,
        draftId,
        payload: snapshotPayloadOf(approval),
        payloadHash: approval.payloadHash,
        approvalId: approval.id,
      })
      .returning();
    if (!snapshot) throw new Error("snapshot insert returned no row");
    const [final] = await tx
      .update(approvals)
      .set({ snapshotId: snapshot.id })
      .where(eq(approvals.id, approval.id))
      .returning();
    return { ok: true, approval: final ?? won, snapshot };
  });
}

async function approveProfileChange(
  db: Db,
  approval: Approval,
  wanted: Approval["status"],
): Promise<DecisionResult> {
  const result = await db
    .transaction(async (tx) => {
      const [won] = await tx
        .update(approvals)
        .set({ status: "approved", resolvedAt: new Date() })
        .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
        .returning();
      if (!won) return "lost" as const;
      const version = await applyProfileChange(tx, won, approval.payload as ProfileChangePayload);
      if (version === null) {
        tx.rollback();
        return "stale" as const;
      }
      const [final] = await tx
        .update(approvals)
        .set({ profileVersion: version })
        .where(eq(approvals.id, approval.id))
        .returning();
      return final ?? won;
    })
    .catch((error: unknown) => {
      // tx.rollback() throws this; the stale case is handled below.
      if (error instanceof TransactionRollbackError) return "stale" as const;
      throw error;
    });

  if (result === "lost") return retry(db, approval.id, wanted);
  if (result === "stale") {
    // The profile changed after this was proposed: the diff no longer applies as shown.
    const updated = await transition(db, approval.id, { status: "stale" });
    return { ok: false, error: "stale", approval: updated ?? approval };
  }
  return { ok: true, approval: result };
}

async function transition(
  db: Db,
  id: string,
  set: Pick<Approval, "status">,
): Promise<Approval | undefined> {
  const [row] = await db
    .update(approvals)
    .set({ ...set, resolvedAt: new Date() })
    .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
    .returning();
  return row;
}

async function retry(db: Db, id: string, wanted: Approval["status"]): Promise<DecisionResult> {
  const current = await db.query.approvals.findFirst({ where: eq(approvals.id, id) });
  return current ? settled(db, current, wanted) : { ok: false, error: "not_found" };
}

/** An approval that is no longer pending: same decision again → same result; otherwise an error. */
async function settled(
  db: Pick<Db, "query">,
  approval: Approval,
  wanted: Approval["status"],
): Promise<DecisionResult> {
  if (approval.status === wanted) {
    const snapshot = approval.snapshotId
      ? await db.query.jobSnapshots.findFirst({ where: eq(jobSnapshots.id, approval.snapshotId) })
      : undefined;
    return { ok: true, approval, snapshot };
  }
  if (approval.status === "stale" || approval.status === "superseded") {
    return { ok: false, error: approval.status, approval };
  }
  return { ok: false, error: "already_resolved", approval };
}

export async function getApproval(db: Db, id: string): Promise<Approval | undefined> {
  return db.query.approvals.findFirst({ where: eq(approvals.id, id) });
}

export type JobOverview = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  updatedAt: Date;
  draftVersion: number | null;
  approvedVersion: number | null;
  pendingApproval: boolean;
  /** Profile version the latest draft used; compare with the current one for staleness. */
  draftProfileVersion: number | null;
  /** True when the latest draft was written against an older approved profile. */
  profileStale: boolean;
  /** Verdict, fit and counts of the latest draft. */
  summary: AssessmentSummary | null;
};

/** Jobs with their latest draft and approved versions, newest first (optionally only `ids`). */
export async function listJobs(db: Db, ids?: string[]): Promise<JobOverview[]> {
  if (ids?.length === 0) return [];
  const profileVersion = await currentProfileVersion(db);
  const query = db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      updatedAt: jobs.updatedAt,
      draftVersion: sql<
        number | null
      >`(select max(version) from app_job_drafts d where d.job_id = "app_jobs"."id")`,
      approvedVersion: sql<
        number | null
      >`(select max(version) from app_job_snapshots s where s.job_id = "app_jobs"."id")`,
      pending: sql<number>`(select count(*) from app_approvals a where a.job_id = "app_jobs"."id" and a.status = 'pending')`,
      draftProfileVersion: sql<
        number | null
      >`(select d.profile_version from app_job_drafts d where d.job_id = "app_jobs"."id" order by d.version desc limit 1)`,
      draftAssessment: sql<
        string | null
      >`(select d.assessment from app_job_drafts d where d.job_id = "app_jobs"."id" order by d.version desc limit 1)`,
    })
    .from(jobs);
  const rows = await (ids ? query.where(inArray(jobs.id, ids)) : query).orderBy(
    desc(jobs.updatedAt),
  );
  const overviews = rows.map(({ pending, draftAssessment, ...row }) => ({
    ...row,
    summary: summaryOf(draftAssessment),
    pendingApproval: pending > 0,
    profileStale: row.draftProfileVersion !== null && row.draftProfileVersion !== profileVersion,
  }));
  // Keep search ranking when ids are given.
  return ids ? ids.flatMap((id) => overviews.filter((o) => o.id === id)) : overviews;
}

/** At-a-glance summary of a stored draft; null when there is none or it no longer parses. */
function summaryOf(json: string | null): AssessmentSummary | null {
  if (!json) return null;
  const parsed = assessmentSchema.safeParse(JSON.parse(json));
  return parsed.success ? assessmentSummary(parsed.data) : null;
}

/** A job with its sources (metadata only), latest draft and every approved snapshot. */
export async function getJobDetail(db: Db, jobId: string) {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) return undefined;
  const [jobSources, draft, snapshots, pending] = await Promise.all([
    db
      .select({
        id: sources.id,
        kind: sources.kind,
        provider: sources.provider,
        url: sources.url,
        truncated: sources.truncated,
        retrievedAt: sources.retrievedAt,
      })
      .from(sources)
      .where(eq(sources.jobId, jobId))
      .orderBy(desc(sources.retrievedAt)),
    latestDraft(db, jobId),
    db.query.jobSnapshots.findMany({
      where: eq(jobSnapshots.jobId, jobId),
      orderBy: desc(jobSnapshots.version),
    }),
    db.query.approvals.findMany({
      where: and(eq(approvals.jobId, jobId), eq(approvals.status, "pending")),
      columns: { id: true, threadId: true, draftVersion: true },
    }),
  ]);
  const [profileVersion, jobClaims] = await Promise.all([
    currentProfileVersion(db),
    db.query.claims.findMany({ where: eq(claims.jobId, jobId), orderBy: desc(claims.createdAt) }),
  ]);
  return {
    job,
    claims: jobClaims,
    sources: jobSources,
    draft,
    snapshots,
    pending,
    profileVersion,
    profileStale: draft !== undefined && draft.profileVersion !== profileVersion,
  };
}

/** An approval as the approval card shows it, with the resulting version once approved. */
export async function getApprovalView(db: Db, id: string) {
  const approval = await getApproval(db, id);
  if (!approval) return undefined;
  const common = {
    id: approval.id,
    threadId: approval.threadId,
    status: approval.status,
    payloadHash: approval.payloadHash,
  };
  if (approval.kind === "profile_change") {
    return {
      ...common,
      kind: "profile_change" as const,
      payload: approval.payload as ProfileChangePayload,
      profileVersion: approval.profileVersion,
    };
  }
  const snapshot = approval.snapshotId
    ? await db.query.jobSnapshots.findFirst({
        where: eq(jobSnapshots.id, approval.snapshotId),
        columns: { version: true },
      })
    : undefined;
  return {
    ...common,
    kind: "job_snapshot" as const,
    jobId: approval.jobId,
    draftVersion: approval.draftVersion,
    payload: snapshotPayloadOf(approval),
    snapshotVersion: snapshot?.version ?? null,
  };
}

export type ApprovalView = NonNullable<Awaited<ReturnType<typeof getApprovalView>>>;

/** Pending approvals proposed in one chat, as the agent sees them each turn. */
export async function pendingApprovalsForThread(db: Db, threadId: string) {
  const rows = await db.query.approvals.findMany({
    where: and(eq(approvals.threadId, threadId), eq(approvals.status, "pending")),
    orderBy: desc(approvals.createdAt),
  });
  return rows.map((a) =>
    a.kind === "job_snapshot"
      ? {
          id: a.id,
          kind: a.kind,
          summary: `snapshot of ${[snapshotPayloadOf(a).job.title, snapshotPayloadOf(a).job.company].filter(Boolean).join(" at ") || "a job"} (draft v${a.draftVersion}, jobId ${a.jobId})`,
        }
      : {
          id: a.id,
          kind: a.kind,
          summary: `profile change: ${(a.payload as ProfileChangePayload).changes
            .map((c) => (c.op === "remove" ? `remove "${c.before.text}"` : `${c.op} "${c.text}"`))
            .join("; ")}`,
        },
  );
}

/** Approval lifecycle events of one chat (for the technical panel). */
export async function approvalsForThread(db: Db, threadId: string) {
  return db.query.approvals.findMany({
    where: eq(approvals.threadId, threadId),
    columns: { id: true, kind: true, status: true, createdAt: true, resolvedAt: true },
    orderBy: desc(approvals.createdAt),
  });
}

export type BatchApprovalOutcome = "approved" | "changed" | "not_found" | DecisionError;

/**
 * The user's "approve all" click on drafts they were shown (e.g. a re-score batch). Each one
 * goes through the normal propose → approve path in that chat; a draft that is no longer its
 * job's latest is skipped as `changed`, never approved in place of what was shown.
 */
export async function approveDrafts(
  db: Db,
  input: { threadId: string; draftIds: string[] },
): Promise<{ draftId: string; jobId?: string; outcome: BatchApprovalOutcome }[]> {
  const results = [];
  for (const draftId of input.draftIds) {
    const draft = await db.query.jobDrafts.findFirst({ where: eq(jobDrafts.id, draftId) });
    if (!draft) {
      results.push({ draftId, outcome: "not_found" as const });
      continue;
    }
    const { approval } = await proposeSnapshot(db, {
      jobId: draft.jobId,
      threadId: input.threadId,
    });
    if (approval.draftId !== draftId) {
      results.push({ draftId, jobId: draft.jobId, outcome: "changed" as const });
      continue;
    }
    const decided = await decideApproval(db, {
      approvalId: approval.id,
      threadId: input.threadId,
      decision: "approve",
      payloadHash: approval.payloadHash,
    });
    results.push({
      draftId,
      jobId: draft.jobId,
      outcome: decided.ok ? ("approved" as const) : decided.error,
    });
  }
  return results;
}
