import { listJobs } from "@copilot/db";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { appDb } from "@/server/db";

export default function JobsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Jobs</h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading jobs…</p>}>
          <JobList />
        </Suspense>
      </div>
    </div>
  );
}

async function JobList() {
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const jobs = await listJobs(await appDb());
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No jobs yet. Paste a listing or URL into a chat.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border" aria-label="Jobs">
      {jobs.map((job) => (
        <li key={job.id}>
          <Link
            href={`/jobs/${job.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-muted/50"
          >
            <span className="font-medium">{job.title ?? "Untitled job"}</span>
            <span className="text-sm text-muted-foreground">
              {[job.company, job.location].filter(Boolean).join(" · ")}
            </span>
            <span className="ml-auto flex gap-1.5">
              {job.approvedVersion !== null && (
                <Badge>
                  <CheckIcon />
                  Approved v{job.approvedVersion}
                </Badge>
              )}
              {job.draftVersion !== null && (
                <Badge variant="outline">Draft v{job.draftVersion}</Badge>
              )}
              {job.pendingApproval && <Badge variant="secondary">Awaiting approval</Badge>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
