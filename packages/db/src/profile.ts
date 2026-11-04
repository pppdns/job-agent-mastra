import { randomUUID } from "node:crypto";
import { type ProfileProposal, profileProposalSchema } from "@copilot/shared";
import { and, asc, desc, eq, isNull, max, TransactionRollbackError } from "drizzle-orm";
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

/** Validates a proposal against the current profile into the exact payload to apply. */
async function payloadOf(db: Reader, proposal: unknown): Promise<ProfileChangePayload> {
  const parsed = profileProposalSchema.safeParse(proposal);
  if (!parsed.success) throw new AssessmentError(`invalid profile change: ${parsed.error.message}`);
  const { version, facts } = await currentProfile(db);
  return resolveChanges(parsed.data, version, new Map(facts.map((f) => [f.id, f])));
}

async function proposeProfileChangeUnlocked(
  db: Db,
  input: { threadId: string; proposal: unknown },
): Promise<{ approval: Approval; created: boolean }> {
  const payload = await payloadOf(db, input.proposal);
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
        `fact ${change.factId} is not in the current profile; use ids from the profile shown to you`,
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

/**
 * The user's own edit on the profile page: applied right away as a new profile version. It is
 * recorded as an approved profile_change (thread `threadId`) so history stays uniform. Throws
 * AssessmentError when the edit is invalid or the profile moved on since the page was loaded.
 */
export function editProfile(
  db: Db,
  input: { threadId: string; proposal: unknown; baseVersion: number },
): Promise<{ approval: Approval; version: number }> {
  return serializeWrites(db, async () => {
    const payload = await payloadOf(db, input.proposal);
    if (payload.baseVersion !== input.baseVersion) {
      throw new AssessmentError("the profile changed meanwhile; reload and edit again");
    }
    const payloadHash = hashPayload(payload);
    return db.transaction(async (tx) => {
      const [approval] = await tx
        .insert(approvals)
        .values({
          id: randomUUID(),
          kind: "profile_change",
          status: "approved",
          threadId: input.threadId,
          payload,
          payloadHash,
          idempotencyKey: `profile_edit:${randomUUID()}`,
          resolvedAt: new Date(),
        })
        .returning();
      if (!approval) throw new Error("approval insert returned no row");
      const version = await applyProfileChange(tx, approval, payload);
      if (version === null) throw new Error("profile moved inside the write lock");
      const [final] = await tx
        .update(approvals)
        .set({ profileVersion: version })
        .where(eq(approvals.id, approval.id))
        .returning();
      return { approval: final ?? approval, version };
    });
  });
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
    change: changes[i]?.payload,
  }));
}

/** Pending profile proposals created from the given chat. */
export async function pendingProfileChanges(db: Reader, threadId: string): Promise<Approval[]> {
  return db.query.approvals.findMany({
    where: and(
      eq(approvals.kind, "profile_change"),
      eq(approvals.status, "pending"),
      eq(approvals.threadId, threadId),
    ),
    orderBy: desc(approvals.createdAt),
  });
}

export type DecisionError =
  | "not_found"
  | "wrong_thread"
  | "stale"
  | "superseded"
  | "already_resolved";

export type DecisionResult =
  | { ok: true; approval: Approval }
  | { ok: false; error: DecisionError; approval?: Approval };

export type DecisionInput = {
  approvalId: string;
  threadId: string;
  decision: "approve" | "reject";
  payloadHash: string;
};

/**
 * Applies the user's decision on a profile change the copilot proposed. Only the user (via the
 * web app) calls this, never a tool. Rejects decisions from another chat, for a changed payload,
 * or when the profile moved on since the proposal. Repeating a decision that already succeeded
 * returns the same result (lost-response retry).
 */
export function decideApproval(db: Db, input: DecisionInput): Promise<DecisionResult> {
  return serializeWrites(db, () => decideApprovalUnlocked(db, input));
}

async function decideApprovalUnlocked(db: Db, input: DecisionInput): Promise<DecisionResult> {
  const approval = await getApproval(db, input.approvalId);
  if (!approval) return { ok: false, error: "not_found" };
  if (approval.threadId !== input.threadId) return { ok: false, error: "wrong_thread" };

  const wanted = input.decision === "approve" ? "approved" : "rejected";
  if (approval.status !== "pending") return settled(approval, wanted);
  if (approval.payloadHash !== input.payloadHash) return { ok: false, error: "stale", approval };

  if (input.decision === "reject") {
    const updated = await transition(db, approval.id, { status: "rejected" });
    return updated ? { ok: true, approval: updated } : retry(db, approval.id, wanted);
  }

  const result = await db
    .transaction(async (tx) => {
      // Conditional update: only one concurrent approval of this row can win.
      const [won] = await tx
        .update(approvals)
        .set({ status: "approved", resolvedAt: new Date() })
        .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
        .returning();
      if (!won) return "lost" as const;
      const version = await applyProfileChange(tx, won, approval.payload);
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
  const current = await getApproval(db, id);
  return current ? settled(current, wanted) : { ok: false, error: "not_found" };
}

/** An approval that is no longer pending: same decision again → same result; otherwise an error. */
function settled(approval: Approval, wanted: Approval["status"]): DecisionResult {
  if (approval.status === wanted) return { ok: true, approval };
  if (approval.status === "stale" || approval.status === "superseded") {
    return { ok: false, error: approval.status, approval };
  }
  return { ok: false, error: "already_resolved", approval };
}

export async function getApproval(db: Reader, id: string): Promise<Approval | undefined> {
  return db.query.approvals.findFirst({ where: eq(approvals.id, id) });
}

/** An approval as the approval card shows it, with the resulting profile version once approved. */
export async function getApprovalView(db: Reader, id: string) {
  const approval = await getApproval(db, id);
  if (!approval) return undefined;
  return {
    id: approval.id,
    threadId: approval.threadId,
    status: approval.status,
    payloadHash: approval.payloadHash,
    payload: approval.payload,
    profileVersion: approval.profileVersion,
  };
}

export type ApprovalView = NonNullable<Awaited<ReturnType<typeof getApprovalView>>>;

/** Pending approvals proposed in one chat, as the agent sees them each turn. */
export async function pendingApprovalsForThread(db: Reader, threadId: string) {
  const rows = await db.query.approvals.findMany({
    where: and(eq(approvals.threadId, threadId), eq(approvals.status, "pending")),
    orderBy: desc(approvals.createdAt),
  });
  return rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    summary: `profile change: ${a.payload.changes
      .map((c) => (c.op === "remove" ? `remove "${c.before.text}"` : `${c.op} "${c.text}"`))
      .join("; ")}`,
  }));
}

/** Approval lifecycle events of one chat (for the technical panel). */
export async function approvalsForThread(db: Reader, threadId: string) {
  return db.query.approvals.findMany({
    where: eq(approvals.threadId, threadId),
    columns: { id: true, kind: true, status: true, createdAt: true, resolvedAt: true },
    orderBy: desc(approvals.createdAt),
  });
}
