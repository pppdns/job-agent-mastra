import {
  currentProfile,
  getApprovalView,
  pendingProfileChanges,
  profileHistory,
} from "@copilot/db";
import { PROFILE_FACT_KINDS, PROFILE_FACT_LABELS } from "@copilot/shared";
import { connection } from "next/server";
import { Suspense } from "react";
import { ApprovalCard, ProfileDiff } from "@/components/approval-card";
import { PageHeader } from "@/components/page-header";
import { AddFactForm, FactRow } from "@/components/profile-editor";
import { Badge } from "@/components/ui/badge";
import { PROFILE_PAGE_THREAD } from "@/lib/chat-schema";
import { appDb } from "@/server/db";

const formatDate = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default function ProfilePage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Profile</h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading profile…</p>}>
          <Profile />
        </Suspense>
      </div>
    </div>
  );
}

async function Profile() {
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const db = await appDb();
  const [{ version, facts }, pending, history] = await Promise.all([
    currentProfile(db),
    pendingProfileChanges(db, PROFILE_PAGE_THREAD),
    profileHistory(db),
  ]);
  const views = await Promise.all(pending.map((p) => getApprovalView(db, p.id)));

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Approved profile" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">Approved profile</h2>
          <Badge variant="secondary">Version {version}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Durable facts every chat sees. Edits here and suggestions in chats only take effect after
          you approve them. Notes for a single chat stay in that chat.
        </p>
        {facts.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing approved yet.</p>
        )}
        {PROFILE_FACT_KINDS.map((kind) => {
          const items = facts.filter((f) => f.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{PROFILE_FACT_LABELS[kind]}s</h3>
              <ul className="flex flex-col gap-1">
                {items.map((f) => (
                  <FactRow key={f.id} fact={{ id: f.id, kind: f.kind, text: f.text }} />
                ))}
              </ul>
            </div>
          );
        })}
        <AddFactForm />
      </section>

      {views.length > 0 && (
        <section aria-label="Pending changes" className="flex flex-col gap-2">
          <h2 className="font-medium">Waiting for your approval</h2>
          {views.flatMap((v) =>
            v
              ? [
                  <ApprovalCard
                    key={v.id}
                    approvalId={v.id}
                    threadId={PROFILE_PAGE_THREAD}
                    initial={v}
                  />,
                ]
              : [],
          )}
        </section>
      )}

      <section aria-label="History" className="flex flex-col gap-3">
        <h2 className="font-medium">History</h2>
        {history.length === 0 && <p className="text-sm text-muted-foreground">No changes yet.</p>}
        {history.map((h) => (
          <div key={h.version} className="flex flex-col gap-1 rounded-lg border p-3">
            <p className="text-sm">
              <span className="font-medium">Version {h.version}</span>{" "}
              <span className="text-muted-foreground">
                {formatDate(h.createdAt)}
                {h.change ? ` · ${h.change.reason}` : ""}
              </span>
            </p>
            {h.change && <ProfileDiff payload={h.change} />}
          </div>
        ))}
      </section>
    </div>
  );
}
