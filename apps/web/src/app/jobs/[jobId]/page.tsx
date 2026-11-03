import { getJobDetail } from "@copilot/db";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AssessmentView } from "@/components/assessment-view";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { appDb } from "@/server/db";

const SOURCE_LABELS = {
  linkedin: "LinkedIn listing",
  ats: "Employer job posting",
  web: "Web page",
  pasted: "Pasted text",
} as const;

const formatDate = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default function JobPage({ params }: PageProps<"/jobs/[jobId]">) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
          Jobs
        </Link>
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading job…</p>}>
          <JobDetail params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function JobDetail({ params }: Pick<PageProps<"/jobs/[jobId]">, "params">) {
  const { jobId } = await params;
  await connection();
  const detail = await getJobDetail(await appDb(), jobId);
  if (!detail) notFound();
  const { job, sources, draft, snapshots, pending } = detail;
  const latestApproved = snapshots[0];
  const draftAhead = draft && latestApproved && latestApproved.payload.draftVersion < draft.version;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{job.title ?? "Untitled job"}</h1>
        <p className="text-sm text-muted-foreground">
          {[job.company, job.location].filter(Boolean).join(" · ")}
        </p>
      </div>

      <section className="flex flex-col gap-2" aria-label="Sources">
        <h2 className="font-medium">Sources read</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap gap-x-2">
              <span>{SOURCE_LABELS[s.kind]}</span>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate underline-offset-4 hover:underline"
                >
                  {s.url}
                </a>
              )}
              <span className="text-muted-foreground">
                read {formatDate(s.retrievedAt)} via {s.provider}
                {s.truncated ? " (snapshot truncated)" : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {draft && (
        <Card className="border-dashed" aria-label="Current draft">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Current draft <Badge variant="outline">Draft v{draft.version} · not approved</Badge>
              {pending.length > 0 && <Badge variant="secondary">Awaiting approval</Badge>}
            </CardTitle>
            <CardDescription>
              Saved automatically {formatDate(draft.createdAt)}.
              {draftAhead && ` Changed since approved v${latestApproved.version}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssessmentView assessment={draft.assessment} />
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3" aria-label="Approved snapshots">
        <h2 className="font-medium">Approved snapshots</h2>
        {snapshots.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing approved yet.</p>
        )}
        {snapshots.map((s, index) => (
          <Card key={s.id}>
            <Collapsible defaultOpen={index === 0}>
              <CardHeader>
                <CollapsibleTrigger className="flex flex-wrap items-center gap-2 text-left">
                  <Badge>
                    <CheckIcon />
                    Approved v{s.version}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatDate(s.createdAt)} · from draft v{s.payload.draftVersion}
                  </span>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <AssessmentView assessment={s.payload.assessment} />
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
      </section>
    </div>
  );
}
