import { createHash, randomUUID } from "node:crypto";
import { allPoints, assessmentSchema, SOURCED_EVIDENCE_CLASSES } from "@copilot/shared";
import { and, desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
  type Approval,
  approvals,
  type JobDraft,
  type JobSnapshot,
  jobDrafts,
  jobSnapshots,
  jobs,
  type SnapshotPayload,
  sources,
} from "./schema";
import { serializeWrites } from "./write-lock";

/** A deterministic rule was broken; the message is safe to show to the model. */
export class AssessmentError extends Error {}

/** Stable hash of a JSON value (object keys sorted), used to bind approvals to exact payloads. */
export function hashPayload(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/**
 * Saves the next draft version for a job. Evidence must cite sources stored for that job,
 * and sourced evidence classes must cite at least one.
 */
export function saveDraft(
  db: Db,
  input: { jobId: string; assessment: unknown; threadId?: string | null },
): Promise<JobDraft> {
  return serializeWrites(db, () => saveDraftUnlocked(db, input));
}

async function saveDraftUnlocked(
  db: Db,
  input: { jobId: string; assessment: unknown; threadId?: string | null },
): Promise<JobDraft> {
  const parsed = assessmentSchema.safeParse(input.assessment);
  if (!parsed.success) throw new AssessmentError(`invalid assessment: ${parsed.error.message}`);
  const assessment = parsed.data;

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
        threadId: input.threadId ?? null,
      })
      .returning();
    await tx.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, job.id));
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
      return current
        ? settled(tx as unknown as Db, current, wanted)
        : { ok: false, error: "not_found" };
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
        payload: approval.payload,
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
};

/** All jobs with their latest draft and approved versions, newest first. */
export async function listJobs(db: Db): Promise<JobOverview[]> {
  const rows = await db
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
    })
    .from(jobs)
    .orderBy(desc(jobs.updatedAt));
  return rows.map(({ pending, ...row }) => ({ ...row, pendingApproval: pending > 0 }));
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
  return { job, sources: jobSources, draft, snapshots, pending };
}
