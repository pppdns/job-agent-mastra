import { randomUUID } from "node:crypto";
import { claimInputSchema, SOURCED_EVIDENCE_CLASSES } from "@copilot/shared";
import { asc, eq } from "drizzle-orm";
import { AssessmentError } from "./hash";
import type { Db } from "./index";
import { type Claim, claims, jobs, sources } from "./schema";
import { serializeWrites } from "./write-lock";

/**
 * Records one researched claim. Cited sources must belong to the job; listing/official,
 * independent and anonymous claims must cite at least one.
 */
export function recordClaim(
  db: Db,
  input: { jobId: string; runId: string; threadId?: string | null; claim: unknown },
): Promise<Claim> {
  return serializeWrites(db, async () => {
    const parsed = claimInputSchema.safeParse(input.claim);
    if (!parsed.success) throw new AssessmentError(`invalid claim: ${parsed.error.message}`);
    const claim = parsed.data;
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, input.jobId) });
    if (!job) throw new AssessmentError(`unknown job id ${input.jobId}`);
    const known = new Set(
      (await db.select({ id: sources.id }).from(sources).where(eq(sources.jobId, job.id))).map(
        (s) => s.id,
      ),
    );
    const unknown = claim.sourceIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new AssessmentError(`source ids ${unknown.join(", ")} were not read for this job`);
    }
    if (SOURCED_EVIDENCE_CLASSES.includes(claim.evidence) && claim.sourceIds.length === 0) {
      throw new AssessmentError(
        `a ${claim.evidence} claim must cite a source id from extract_page; otherwise mark it inference`,
      );
    }
    const [row] = await db
      .insert(claims)
      .values({
        id: randomUUID(),
        jobId: job.id,
        runId: input.runId,
        threadId: input.threadId ?? null,
        topic: claim.topic,
        text: claim.text,
        evidence: claim.evidence,
        sourceIds: claim.sourceIds,
        quote: claim.quote ?? null,
        publishedAt: claim.publishedAt ?? null,
        eventDate: claim.eventDate ?? null,
      })
      .returning();
    if (!row) throw new Error("claim insert returned no row");
    return row;
  });
}

export async function listClaims(db: Db, filter: { jobId?: string; runId?: string }) {
  const where = filter.runId
    ? eq(claims.runId, filter.runId)
    : eq(claims.jobId, filter.jobId ?? "");
  return db.query.claims.findMany({ where, orderBy: asc(claims.createdAt) });
}
