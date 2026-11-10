import { companyJobs, getJobDetail } from "@copilot/db";
import { JOB_STATUS_LABELS } from "@copilot/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FitMeter } from "@/components/assessment-visuals";
import { EvidenceList } from "@/components/evidence-list";
import { PageHeader } from "@/components/page-header";
import { TriageScore } from "@/components/triage-score";
import { Badge } from "@/components/ui/badge";
import { appDb } from "@/server/db";

// One company: every role saved or discovered there (also the hidden ones, marked), their
// statuses, and research findings across those roles. Companies are grouped by company key
// (`companyKey`: legal forms and punctuation don't split a company).

export default function CompanyPage({ params }: PageProps<"/companies/[key]">) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
          Jobs
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="text-sm font-semibold">Company</h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading company…</p>}>
          <Company params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function Company({ params }: Pick<PageProps<"/companies/[key]">, "params">) {
  const { key } = await params;
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const db = await appDb();
  const jobs = await companyJobs(db, decodeURIComponent(key));
  if (jobs.length === 0) notFound();
  const name = mostCommon(jobs.flatMap((j) => (j.company ? [j.company] : []))) ?? key;
  const researched = await Promise.all(
    jobs.filter((j) => j.claimCount > 0).map((j) => getJobDetail(db, j.id)),
  );
  const claims = researched.flatMap((d) => d?.claims ?? []);
  const sources = researched.flatMap((d) => d?.sources ?? []);
  const open = jobs.filter((j) => !j.archivedAt && !j.hidden).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">{name}</h2>
        <p className="text-sm text-muted-foreground">
          {jobs.length} role{jobs.length === 1 ? "" : "s"} · {open} open in your list
        </p>
      </div>

      <section aria-label="Roles" className="flex flex-col gap-2">
        <h3 className="font-medium">Roles</h3>
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <Link
                  href={`/jobs/${job.id}`}
                  className="font-medium after:absolute after:inset-0 hover:underline"
                >
                  {job.title ?? "Untitled job"}
                </Link>
                {job.location && <span className="text-muted-foreground"> · {job.location}</span>}
                {(job.summary?.headline ?? job.triageReason) && (
                  <span className="block text-xs text-muted-foreground">
                    {job.summary?.headline ?? job.triageReason}
                  </span>
                )}
              </span>
              {job.summary ? (
                <FitMeter fitLevel={job.summary.fitLevel} fitBasis={job.summary.fitBasis} />
              ) : (
                job.origin === "discovery" && <TriageScore score={job.triageScore} />
              )}
              <Badge variant={job.archivedAt ? "secondary" : "outline"}>
                {JOB_STATUS_LABELS[job.status]}
                {job.archivedAt ? " · archived" : ""}
              </Badge>
              {job.hidden && <Badge variant="secondary">Screened out</Badge>}
            </li>
          ))}
        </ul>
      </section>

      {claims.length > 0 && (
        <section aria-label="Research" className="flex flex-col gap-2">
          <h3 className="font-medium">Research</h3>
          <p className="text-sm text-muted-foreground">
            Findings from research runs on this company's roles, read from web pages (untrusted).
          </p>
          <EvidenceList claims={claims} sources={sources} />
        </section>
      )}
    </div>
  );
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
