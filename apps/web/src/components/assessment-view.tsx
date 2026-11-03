import { type Assessment, type AssessmentPoint, assessmentSummary } from "@copilot/shared";
import { cn } from "cn";
import { ArrowRightIcon, CircleHelpIcon, MessageCircleQuestionIcon } from "lucide-react";
import {
  EvidenceBadge,
  SIGNALS,
  SummaryHeader,
  TONE_FILL,
  TONES,
  VERDICT,
  VerdictBadge,
} from "@/components/assessment-visuals";

type PointKey = "hardConflicts" | "strengths" | "weaknesses" | "softTradeoffs";

/**
 * Read-only rendering of an assessment: summary first, then color-coded sections.
 * Evidence class shown on every point.
 */
export function AssessmentView({
  assessment,
  showSummary = true,
}: {
  assessment: Assessment;
  /** Off when the surrounding card already shows the summary header. */
  showSummary?: boolean;
}) {
  const { recommendation } = assessment;
  const verdict = VERDICT[recommendation.verdict];
  return (
    <div className="flex flex-col gap-5 text-sm">
      {showSummary && <SummaryHeader summary={assessmentSummary(assessment)} />}
      <p className="leading-relaxed text-muted-foreground">{assessment.overview}</p>

      {assessment.hardConflicts.length > 0 && (
        <div className={cn("rounded-lg border p-3", TONES.destructive)}>
          <Points kind="hardConflicts" points={assessment.hardConflicts} />
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Points kind="strengths" points={assessment.strengths} />
        <Points kind="weaknesses" points={assessment.weaknesses} />
      </div>
      <Points kind="softTradeoffs" points={assessment.softTradeoffs} />

      {assessment.unknowns.length > 0 && (
        <Section icon={CircleHelpIcon} tone="text-muted-foreground" title="Unknowns">
          <ul className="flex flex-col gap-2">
            {assessment.unknowns.map((u) => (
              <li key={u.question} className="rounded-md bg-muted/60 px-3 py-2">
                <p className="font-medium">{u.question}</p>
                <p className="text-muted-foreground">{u.whyItMatters}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {assessment.recruiterQuestions.length > 0 && (
        <Section
          icon={MessageCircleQuestionIcon}
          tone="text-info"
          title="Questions for the recruiter"
        >
          <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
            {assessment.recruiterQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </Section>
      )}

      <section
        aria-label="Recommendation"
        className="relative overflow-hidden rounded-lg border bg-card p-3 pl-4"
      >
        <span className={cn("absolute inset-y-0 left-0 w-1", TONE_FILL[verdict.tone])} />
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Recommendation</h3>
            <VerdictBadge verdict={recommendation.verdict} size="sm" />
          </div>
          <p className="leading-relaxed">{recommendation.rationale}</p>
          {recommendation.nextSteps.length > 0 && (
            <ul className="flex flex-col gap-1">
              {recommendation.nextSteps.map((s) => (
                <li key={s} className="flex gap-2">
                  <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Section({
  icon: Icon,
  tone,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Icon className={cn("size-4", tone)} />
        {title}
        {count !== undefined && (
          <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** One color-coded list of points; `limit` shows only the first few (chat card). */
export function Points({
  kind,
  points,
  limit,
}: {
  kind: PointKey;
  points: AssessmentPoint[];
  limit?: number;
}) {
  if (points.length === 0) return null;
  const { label, tone, icon: Icon } = SIGNALS[kind];
  const shown = limit ? points.slice(0, limit) : points;
  const toneText = TONES[tone].split(" ")[0];
  return (
    <Section icon={Icon} tone={toneText} title={label} count={points.length}>
      <ul className="flex flex-col gap-2">
        {shown.map((p) => (
          <li key={p.text} className="flex gap-2">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE_FILL[tone])} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="leading-snug text-foreground">
                {p.text} <EvidenceBadge evidence={p.evidence} />
              </p>
              {p.quote && !limit && (
                <blockquote className="border-l-2 pl-2 text-xs text-muted-foreground italic">
                  “{p.quote}”
                </blockquote>
              )}
            </div>
          </li>
        ))}
        {limit && points.length > limit && (
          <li className="pl-3.5 text-xs text-muted-foreground">+{points.length - limit} more</li>
        )}
      </ul>
    </Section>
  );
}
