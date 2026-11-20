import {
  currentPreferences,
  getJobDetail,
  type Job,
  jobPostings,
  latestListingSource,
} from "@copilot/db";
import {
  assessmentSummary,
  DISCOVERY_SOURCE_LABELS,
  JOB_STATUS_LABELS,
  recruiterPost,
  suggestedResearchTopics,
} from "@copilot/shared";
import {
  BanIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  ExternalLinkIcon,
  GlobeIcon,
  type LucideIcon,
  MapPinIcon,
  NewspaperIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProgressPill } from "@/components/age-pill";
import { AssessmentView } from "@/components/assessment-view";
import { VerdictBadge } from "@/components/assessment-visuals";
import { EvidenceList } from "@/components/evidence-list";
import { InterviewRounds } from "@/components/interview-rounds";
import { ChipEvidence, JobChips } from "@/components/job-chips";
import { JobNotes } from "@/components/job-notes";
import { JobStatusMenu } from "@/components/job-status-menu";
import { AssessButton } from "@/components/keep-buttons";
import { ListingDocument } from "@/components/listing-document";
import { MarkSeen } from "@/components/mark-seen";
import { PageHeader } from "@/components/page-header";
import { ResearchJobButtons } from "@/components/research-job-buttons";
import { TopToggle } from "@/components/top-mark";
import { TriageScore } from "@/components/triage-score";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { APPROXIMATE_HINT, formatDay, isApproximate, postedVerb, progressAge } from "@/lib/job-age";
import { jobChips } from "@/lib/job-chips";
import { listingLinks } from "@/lib/listing-links";
import { appDb } from "@/server/db";

const SOURCE_LABELS = {
  linkedin: "LinkedIn listing",
  ats: "Employer job posting",
  web: "Web page (research)",
  pasted: "Pasted text",
  board: "Job board posting",
} as const;

const SOURCE_ICONS: Record<keyof typeof SOURCE_LABELS, LucideIcon> = {
  linkedin: BriefcaseIcon,
  ats: Building2Icon,
  web: GlobeIcon,
  pasted: ClipboardPasteIcon,
  board: NewspaperIcon,
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
  const db = await appDb();
  const detail = await getJobDetail(db, jobId);
  if (!detail) notFound();
  const [postings, preferences, listing] = await Promise.all([
    jobPostings(db, jobId),
    currentPreferences(db),
    latestListingSource(db, jobId),
  ]);
  const { job, sources, draft, history, profileVersion, profileStale, claims, posted } = detail;
  // A recruiter post: the board's company is the agency, not the employer.
  const post = recruiterPost(job.company, job.facts);
  const links = listingLinks(
    job.canonicalUrl,
    sources,
    postings.map((p) => ({
      url: p.url,
      applyUrl: p.applyUrl,
      sourceLabel: DISCOVERY_SOURCE_LABELS[p.source],
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{job.title ?? "Untitled job"}</h1>
          <span className="ml-auto flex shrink-0 items-center gap-2 pt-1">
            {job.archivedAt && <Badge variant="secondary">Archived</Badge>}
            <TopToggle jobId={job.id} top={job.topAt !== null} />
            <JobStatusMenu
              jobId={job.id}
              title={job.title ?? "Untitled job"}
              status={job.status}
              archived={job.archivedAt !== null}
            />
          </span>
        </div>
        {links.length > 0 && (
          <ul aria-label="Original listing" className="flex flex-wrap gap-2 pt-2">
            {links.map((link, i) => (
              <li key={link.url} className="min-w-0 max-w-full">
                <Button asChild variant={i === 0 ? "default" : "outline"} className="max-w-full">
                  <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
                    <ExternalLinkIcon />
                    <span className="truncate">
                      Open {link.label}
                      <span className="font-normal opacity-80"> · {link.host}</span>
                    </span>
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {job.listingClosedAt && job.listingClosed && (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <BanIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              Listing closed ({job.listingClosed.signal}), found {formatDate(job.listingClosedAt)}
              {job.status === "dismissed"
                ? `. Dismissed automatically (was ${job.listingClosed.previousStatus}); change the status to bring it back.`
                : "."}
            </span>
          </p>
        )}
        <p className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
          {(job.company || post) && (
            <span className="inline-flex items-center gap-1.5">
              <Building2Icon className="size-4" />
              {post && (
                <span className="text-foreground">{post.employer ?? "Employer not named"}</span>
              )}
              {post && job.company && "· via"}
              {job.companyKey ? (
                <Link
                  href={`/companies/${encodeURIComponent(job.companyKey)}`}
                  className="hover:underline"
                >
                  {job.company}
                </Link>
              ) : (
                job.company
              )}
              {post && job.company && " (recruiter)"}
            </span>
          )}
          {job.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPinIcon className="size-4" />
              {job.location}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon className="size-4" />
            {posted && (
              <>
                <time
                  dateTime={posted.at.toISOString()}
                  title={isApproximate(posted.basis) ? APPROXIMATE_HINT : undefined}
                >
                  {postedVerb(posted.basis)} {formatDay(posted.at, posted.basis)}
                </time>
                <span aria-hidden>·</span>
              </>
            )}
            <time dateTime={job.createdAt.toISOString()}>Added {formatDay(job.createdAt)}</time>
          </span>
          {job.statusChangedAt && (
            <span>
              {JOB_STATUS_LABELS[job.status]} since {formatDate(job.statusChangedAt)}
            </span>
          )}
        </p>
        {job.origin === "discovery" && job.seenAt === null && <MarkSeen jobId={job.id} />}
      </div>

      <Progress job={job} />

      <JobNotes
        jobId={job.id}
        notes={job.notes}
        updatedAtMs={job.notesUpdatedAt?.getTime() ?? null}
        editedLabel={job.notesUpdatedAt ? `Edited ${formatDay(job.notesUpdatedAt)}` : null}
      />

      <AtAGlance
        chips={jobChips(
          {
            facts: job.facts,
            eligibility: job.eligibility,
            eligibilityQuote: job.eligibilityQuote,
            salaryText: draft?.assessment.salary,
            hardConflicts: draft?.assessment.hardConflicts.length,
            fitChips: draft ? assessmentSummary(draft.assessment).fitChips : undefined,
          },
          preferences,
        )}
        read={job.facts !== null}
      />

      {job.origin === "discovery" && (
        <Card aria-label="Triage">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Quick triage <TriageScore score={job.triageScore} />
            </CardTitle>
            <CardDescription>
              {job.triageReason ??
                "Not triaged yet: the next discovery run scores it against your profile."}
            </CardDescription>
            {!draft && (
              <div className="pt-1">
                <AssessButton jobId={job.id} />
              </div>
            )}
          </CardHeader>
        </Card>
      )}

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
            {post && !post.employer ? (
              <p className="text-sm text-muted-foreground">
                No company research yet: a recruiter posted this job and the listing doesn't name
                the employer. Ask the recruiter who it is.
              </p>
            ) : (
              <ResearchJobButtons
                jobId={job.id}
                topics={suggestedResearchTopics(draft.assessment)}
              />
            )}
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

      {postings.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Seen on">
          <h2 className="font-semibold">Seen on</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {postings.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener"
                  className="font-medium hover:underline"
                >
                  {DISCOVERY_SOURCE_LABELS[p.source]}
                </a>
                <span className="text-muted-foreground">
                  {p.title} · first seen {formatDate(p.firstSeenAt)}
                  {p.screenReasons ? ` · screened out: ${p.screenReasons.join("; ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Postings from job boards, with credit to each source. Apply through the board's link.
          </p>
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

      {listing && <ListingDocument source={listing} label={SOURCE_LABELS[listing.kind]} />}
    </div>
  );
}

/** The job's chips and, folded, the listing's words each one rests on. */
function AtAGlance({ chips, read }: { chips: ReturnType<typeof jobChips>; read: boolean }) {
  return (
    <section aria-label="At a glance (job)" className="flex flex-col gap-2 rounded-xl border p-3">
      <JobChips {...chips} />
      {read ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="group -ml-1.5 text-muted-foreground">
              From the listing
              <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            <ChipEvidence chips={[...chips.primary, ...chips.secondary]} />
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <p className="text-xs text-muted-foreground">
          The listing's facts haven't been read yet; the next discovery run reads them.
        </p>
      )}
    </section>
  );
}

/**
 * Where a job in progress stands: time since its last progress (colored only when it needs a
 * follow-up) and, while interviewing, the editable round tracker.
 */
function Progress({ job }: { job: Job }) {
  const age = progressAge(job, new Date());
  if (!age) return null;
  const title = job.title ?? "Untitled job";
  return (
    <section
      aria-label="Progress"
      className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2"
    >
      <ProgressPill age={age} long />
      {job.status === "interviewing" && (
        <InterviewRounds
          jobId={job.id}
          title={title}
          round={job.interviewRound}
          total={job.interviewRounds}
          className="min-w-48 flex-1 sm:max-w-xs"
        />
      )}
    </section>
  );
}
