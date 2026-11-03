import {
  type Assessment,
  type AssessmentPoint,
  EVIDENCE_LABELS,
  RECOMMENDATION_LABELS,
} from "@copilot/shared";
import { Badge } from "@/components/ui/badge";

/** Read-only rendering of an assessment; evidence class shown on every point. */
export function AssessmentView({ assessment }: { assessment: Assessment }) {
  const { recommendation } = assessment;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>{assessment.overview}</p>
      <p className="text-muted-foreground">
        {assessment.fitBasis === "role_only"
          ? "Role only: personal fit not assessed yet."
          : "Includes personal fit against your approved profile."}
      </p>
      <Points title="Hard conflicts" points={assessment.hardConflicts} />
      <Points title="Strengths" points={assessment.strengths} />
      <Points title="Weaknesses" points={assessment.weaknesses} />
      <Points title="Tradeoffs" points={assessment.softTradeoffs} />
      {assessment.unknowns.length > 0 && (
        <Section title="Unknowns">
          <ul className="list-disc space-y-1 pl-5">
            {assessment.unknowns.map((u) => (
              <li key={u.question}>
                {u.question} <span className="text-muted-foreground">— {u.whyItMatters}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {assessment.recruiterQuestions.length > 0 && (
        <Section title="Questions for the recruiter">
          <ul className="list-disc space-y-1 pl-5">
            {assessment.recruiterQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={`Recommendation: ${RECOMMENDATION_LABELS[recommendation.verdict]}`}>
        <p>{recommendation.rationale}</p>
        {recommendation.nextSteps.length > 0 && (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {recommendation.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Points({ title, points }: { title: string; points: AssessmentPoint[] }) {
  if (points.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="space-y-1.5">
        {points.map((p) => (
          <li key={p.text} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span>{p.text}</span>
            <Badge variant={p.evidence === "official" ? "secondary" : "outline"}>
              {EVIDENCE_LABELS[p.evidence]}
            </Badge>
            {p.quote && <q className="w-full text-muted-foreground">{p.quote}</q>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
