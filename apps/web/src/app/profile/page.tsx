import { currentProfile, profileHistory } from "@copilot/db";
import { PROFILE_FACT_KINDS, PROFILE_FACT_LABELS } from "@copilot/shared";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProfileDiff } from "@/components/approval-card";
import { PageHeader } from "@/components/page-header";
import { AddFactForm, FactRow } from "@/components/profile-editor";
import { Badge } from "@/components/ui/badge";
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
  const [{ version, facts }, history] = await Promise.all([currentProfile(db), profileHistory(db)]);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Your profile" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">Your profile</h2>
          <Badge variant="secondary">Version {version}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Durable facts every chat sees. Edits here apply right away; changes the copilot suggests
          in a chat take effect only after you approve them there. Notes for a single chat stay in
          that chat.
        </p>
        {facts.length === 0 && <p className="text-sm text-muted-foreground">No facts yet.</p>}
        {PROFILE_FACT_KINDS.map((kind) => {
          const items = facts.filter((f) => f.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{PROFILE_FACT_LABELS[kind]}s</h3>
              <ul className="flex flex-col gap-1">
                {items.map((f) => (
                  <FactRow
                    key={f.id}
                    fact={{ id: f.id, kind: f.kind, text: f.text }}
                    version={version}
                  />
                ))}
              </ul>
            </div>
          );
        })}
        <AddFactForm version={version} />
      </section>

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
