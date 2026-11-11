import { currentProfile, profileHistory } from "@copilot/db";
import { PROFILE_FACT_KINDS } from "@copilot/shared";
import { ChevronDownIcon, HistoryIcon } from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProfileDiff } from "@/components/approval-card";
import { PageHeader } from "@/components/page-header";
import { AddFactForm, FactRow } from "@/components/profile-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PROFILE_KIND_UI } from "@/lib/profile-kinds";
import { cn } from "@/lib/utils";
import { appDb } from "@/server/db";

const formatDate = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default function ProfilePage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Profile</h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 sm:p-6">
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
    <div className="flex flex-col gap-8">
      <section aria-label="Your profile" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Your profile</h2>
            <Badge variant="outline" className="text-muted-foreground">
              v{version}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            What every chat and every job assessment is judged against. Edits here apply right away;
            changes the copilot suggests in a chat apply after you approve them there.
          </p>
        </div>

        {PROFILE_FACT_KINDS.map((kind) => {
          const items = facts.filter((f) => f.kind === kind);
          const { title, icon: Icon, hint, accent } = PROFILE_KIND_UI[kind];
          return (
            <section
              key={kind}
              aria-label={title}
              className="flex flex-col gap-2 rounded-xl border p-3 sm:p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    accent,
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    {title}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {items.length}
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
              </div>
              {items.length > 0 ? (
                <ul className="-mx-2 flex flex-col sm:ml-9">
                  {items.map((f) => (
                    <FactRow
                      key={f.id}
                      fact={{ id: f.id, kind: f.kind, text: f.text }}
                      version={version}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground italic sm:ml-11">
                  None yet. Add one below.
                </p>
              )}
            </section>
          );
        })}

        <AddFactForm version={version} />
      </section>

      <Collapsible aria-label="History">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-2 text-muted-foreground">
            <HistoryIcon />
            History · {history.length} {history.length === 1 ? "version" : "versions"}
            <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-3">
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
