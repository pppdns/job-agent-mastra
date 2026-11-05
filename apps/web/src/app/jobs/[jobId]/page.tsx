import { getJobDetail } from "@copilot/db";
import { JOB_STATUS_LABELS, suggestedResearchTopics } from "@copilot/shared";
import {
  BriefcaseIcon,
  Building2Icon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  ExternalLinkIcon,
  GlobeIcon,
  type LucideIcon,
  MapPinIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AssessmentView } from "@/components/assessment-view";
import { SalaryLabel, VerdictBadge } from "@/components/assessment-visuals";
import { EvidenceList } from "@/components/evidence-list";
import { JobStatusMenu } from "@/components/job-status-menu";
import { PageHeader } from "@/components/page-header";
import { ResearchJobButtons } from "@/components/research-job-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { listingLinks } from "@/lib/listing-links";
import { appDb } from "@/server/db";

const SOURCE_LABELS = {
  linkedin: "LinkedIn listing",
  ats: "Employer job posting",
  web: "Web page (research)",
  pasted: "Pasted text",
} as const;

const SOURCE_ICONS: Record<keyof typeof SOURCE_LABELS, LucideIcon> = {
  linkedin: BriefcaseIcon,
  ats: Building2Icon,
  web: GlobeIcon,
  pasted: ClipboardPasteIcon,
};

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
  const { job, sources, draft, history, profileVersion, profileStale, claims } = detail;
  const links = listingLinks(job.canonicalUrl, sources);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{job.title ?? "Untitled job"}</h1>
          <span className="ml-auto flex shrink-0 items-center gap-2 pt-1">
            {job.archivedAt && <Badge variant="secondary">Archived</Badge>}
            <JobStatusMenu
              jobId={job.id}
              title={job.title ?? "Untitled job"}
              status={job.status}
              archived={job.archivedAt !== null}
            />
          </span>
        </div>
        <p className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
          {job.company && (
            <span className="inline-flex items-center gap-1.5">
              <Building2Icon className="size-4" />
              {job.company}
            </span>
          )}
          {job.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPinIcon className="size-4" />
              {job.location}
            </span>
          )}
          {draft?.assessment.salary && <SalaryLabel salary={draft.assessment.salary} />}
          {job.statusChangedAt && (
            <span>
              {JOB_STATUS_LABELS[job.status]} since {formatDate(job.statusChangedAt)}
            </span>
          )}
        </p>
        {links.length > 0 && (
          <ul aria-label="Original listing" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {links.map((link) => (
              <li key={link.url} className="min-w-0">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.url}
                  className="inline-flex max-w-full items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                >
                  <ExternalLinkIcon className="size-4 shrink-0" />
                  <span className="truncate">
                    {link.label}
                    <span className="font-normal text-muted-foreground"> · {link.host}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {draft && (
        <Card aria-label="Current assessment">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Assessment <Badge variant="secondary">v{draft.version}</Badge>
              {profileStale && <Badge variant="destructive">Profile changed · review</Badge>}
            </CardTitle>
            <CardDescription>
              Saved {formatDate(draft.createdAt)} using profile v{draft.profileVersion}
              {profileStale ? ` (current profile is v${profileVersion})` : ""}.
            </CardDescription>
            <ResearchJobButtons jobId={job.id} topics={suggestedResearchTopics(draft.assessment)} />
          </CardHeader>
          <CardContent>
            <AssessmentView assessment={draft.assessment} />
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Collapsible aria-label="Version history">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2 text-muted-foreground">
              <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
              Version history · {history.length} earlier
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
            {history.map((d) => (
              <Card key={d.id}>
                <Collapsible>
                  <CardHeader>
                    <CollapsibleTrigger className="flex flex-wrap items-center gap-2 text-left">
                      <Badge variant="outline">v{d.version}</Badge>
                      <VerdictBadge verdict={d.assessment.recommendation.verdict} size="sm" />
                      <span className="text-sm text-muted-foreground">
                        {formatDate(d.createdAt)} · profile v{d.profileVersion}
                      </span>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>
                      <AssessmentView assessment={d.assessment} />
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {claims.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Evidence">
          <h2 className="font-semibold">Research evidence</h2>
          <p className="text-sm text-muted-foreground">
            Findings from research runs, read from web pages (untrusted). The assessment uses only
            the ones it cites.
          </p>
          <EvidenceList claims={claims} sources={sources} />
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="Sources">
        <h2 className="font-semibold">Sources read</h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {sources.map((s) => {
            const Icon = SOURCE_ICONS[s.kind];
            return (
              <li key={s.id} className="flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-medium">{SOURCE_LABELS[s.kind]}</span>
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {s.url}
                  </a>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {formatDate(s.retrievedAt)} · {s.provider}
                  {s.truncated ? " · truncated" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
