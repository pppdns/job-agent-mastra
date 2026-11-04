import { randomUUID } from "node:crypto";
import { type ProfileProposal, profileProposalSchema } from "@copilot/shared";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import { AssessmentError, hashPayload } from "./hash";
import type { Db } from "./index";
import {
  type Approval,
  approvals,
  type ProfileChangePayload,
  type ProfileFact,
  profileFacts,
  profileVersions,
} from "./schema";
import { serializeWrites } from "./write-lock";

type Reader = Pick<Db, "select" | "query">;

/** Current approved profile version (0 before anything was approved). */
export async function currentProfileVersion(db: Reader): Promise<number> {
  const [row] = await db.select({ v: max(profileVersions.version) }).from(profileVersions);
  return row?.v ?? 0;
}

/** The approved profile: current facts and the version they belong to. */
export async function currentProfile(
  db: Reader,
): Promise<{ version: number; facts: ProfileFact[] }> {
  const [version, facts] = await Promise.all([
    currentProfileVersion(db),
    db.query.profileFacts.findMany({
      where: isNull(profileFacts.supersededInVersion),
      orderBy: [asc(profileFacts.kind), asc(profileFacts.createdAt)],
    }),
  ]);
  return { version, facts };
}

/**
 * Proposes an exact change to the approved profile. Facts referenced by modify/remove must be
 * current; the payload records their text before the change so the user sees the full diff.
 * Nothing changes until the user approves (decideApproval).
 */
export function proposeProfileChange(
  db: Db,
  input: { threadId: string; proposal: unknown },
): Promise<{ approval: Approval; created: boolean }> {
  return serializeWrites(db, () => proposeProfileChangeUnlocked(db, input));
}

async function proposeProfileChangeUnlocked(
  db: Db,
  input: { threadId: string; proposal: unknown },
): Promise<{ approval: Approval; created: boolean }> {
  const parsed = profileProposalSchema.safeParse(input.proposal);
  if (!parsed.success) throw new AssessmentError(`invalid profile change: ${parsed.error.message}`);
  const { version, facts } = await currentProfile(db);
  const payload = resolveChanges(parsed.data, version, new Map(facts.map((f) => [f.id, f])));
  const payloadHash = hashPayload(payload);
  const idempotencyKey = `profile_change:${input.threadId}:${payloadHash}`;

  const existing = await db.query.approvals.findFirst({
    where: eq(approvals.idempotencyKey, idempotencyKey),
  });
  if (existing) return { approval: existing, created: false };

  const [approval] = await db
    .insert(approvals)
    .values({
      id: randomUUID(),
      kind: "profile_change",
      status: "pending",
      threadId: input.threadId,
      payload,
      payloadHash,
      idempotencyKey,
    })
    .returning();
  if (!approval) throw new Error("approval insert returned no row");
  return { approval, created: true };
}

/** Edit distance between two strings (Levenshtein). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (const [i, ca] of [...a].entries()) {
    const row = [i + 1];
    for (const [j, cb] of [...b].entries()) {
      row.push(
        Math.min((prev[j + 1] ?? 0) + 1, (row[j] ?? 0) + 1, (prev[j] ?? 0) + (ca === cb ? 0 : 1)),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/**
 * Retry hint for a fact id the model cited that isn't current. Models sometimes miscopy a
 * character of a UUID and repeat it, so name the near match (or list the current ids) with
 * its text; the model must still resend it, nothing is auto-corrected.
 */
export function factIdHint(id: string, facts: Pick<ProfileFact, "id" | "text">[]): string {
  const [best, second] = facts
    .map((f) => ({ f, d: editDistance(id, f.id) }))
    .filter(({ d }) => d <= 3)
    .sort((x, y) => x.d - y.d);
  if (best && (!second || best.d < second.d)) {
    return `; did you mean ${best.f.id} ("${best.f.text.slice(0, 60)}")? Copy ids exactly from [fact:…]`;
  }
  if (facts.length === 0) return "; the approved profile is empty";
  return `; current fact ids: ${facts.map((f) => `${f.id} ("${f.text.slice(0, 40)}")`).join(", ")}`;
}

function resolveChanges(
  proposal: ProfileProposal,
  baseVersion: number,
  current: Map<string, ProfileFact>,
): ProfileChangePayload {
  const touched = new Set<string>();
  const changes = proposal.changes.map((change): ProfileChangePayload["changes"][number] => {
    if (change.op === "add") return change;
    const fact = current.get(change.factId);
    if (!fact) {
      throw new AssessmentError(
        `fact ${change.factId} is not in the current profile${factIdHint(change.factId, [...current.values()])}`,
      );
    }
    if (touched.has(fact.id)) throw new AssessmentError(`fact ${fact.id} is changed twice`);
    touched.add(fact.id);
    const before = { kind: fact.kind, text: fact.text };
    return change.op === "remove"
      ? { op: "remove", factId: fact.id, before }
      : {
          op: "modify",
          factId: fact.id,
          before,
          kind: change.kind ?? fact.kind,
          text: change.text,
        };
  });
  return { baseVersion, reason: proposal.reason, changes };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Applies an approved profile change inside the decision transaction. Returns the new
 * version, or null when the profile moved on since the proposal (the approval is then stale).
 */
export async function applyProfileChange(
  tx: Tx,
  approval: Approval,
  payload: ProfileChangePayload,
): Promise<number | null> {
  const current = await currentProfileVersion(tx);
  if (current !== payload.baseVersion) return null;
  const version = current + 1;
  await tx.insert(profileVersions).values({ version, approvalId: approval.id });
  for (const change of payload.changes) {
    if (change.op !== "add") {
      await tx
        .update(profileFacts)
        .set({ supersededInVersion: version })
        .where(and(eq(profileFacts.id, change.factId), isNull(profileFacts.supersededInVersion)));
    }
    if (change.op !== "remove") {
      await tx.insert(profileFacts).values({
        id: randomUUID(),
        kind: change.kind,
        text: change.text,
        createdInVersion: version,
        supersedesId: change.op === "modify" ? change.factId : null,
      });
    }
  }
  return version;
}

/** Approved profile versions, newest first, with the change that produced each. */
export async function profileHistory(db: Db) {
  const versions = await db.query.profileVersions.findMany({
    orderBy: desc(profileVersions.version),
  });
  const changes = await Promise.all(
    versions.map((v) => db.query.approvals.findFirst({ where: eq(approvals.id, v.approvalId) })),
  );
  return versions.map((v, i) => ({
    version: v.version,
    createdAt: v.createdAt,
    change: changes[i]?.payload as ProfileChangePayload | undefined,
  }));
}

/** Pending profile proposals created from the given thread (e.g. the profile page). */
export async function pendingProfileChanges(db: Db, threadId: string): Promise<Approval[]> {
  return db.query.approvals.findMany({
    where: and(
      eq(approvals.kind, "profile_change"),
      eq(approvals.status, "pending"),
      eq(approvals.threadId, threadId),
    ),
    orderBy: desc(approvals.createdAt),
  });
}
