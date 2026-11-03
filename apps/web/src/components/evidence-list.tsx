import {
  EVIDENCE_LABELS,
  type EvidenceClass,
  RESEARCH_TOPIC_LABELS,
  RESEARCH_TOPICS,
  type ResearchTopic,
} from "@copilot/shared";
import { Badge } from "@/components/ui/badge";

export type EvidenceClaim = {
  id: string;
  topic: ResearchTopic;
  text: string;
  evidence: EvidenceClass;
  sourceIds: string[];
  quote?: string | null;
  publishedAt?: string | null;
  eventDate?: string | null;
};

export type EvidenceSource = { id: string; url: string | null };

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** Researched claims grouped by topic, each with its evidence class, dates and source links. */
export function EvidenceList({
  claims,
  sources,
}: {
  claims: EvidenceClaim[];
  sources: EvidenceSource[];
}) {
  const urls = new Map(sources.map((s) => [s.id, s.url]));
  return (
    <div className="flex flex-col gap-3 text-sm">
      {RESEARCH_TOPICS.map((topic) => {
        const items = claims.filter((c) => c.topic === topic);
        if (items.length === 0) return null;
        return (
          <section key={topic} className="flex flex-col gap-1.5">
            <h3 className="font-medium">{RESEARCH_TOPIC_LABELS[topic]}</h3>
            <ul className="flex flex-col gap-2">
              {items.map((c) => (
                <li key={c.id} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span>{c.text}</span>
                    <Badge
                      variant={
                        c.evidence === "official" || c.evidence === "independent"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {EVIDENCE_LABELS[c.evidence]}
                    </Badge>
                  </div>
                  {c.quote && <q className="text-muted-foreground">{c.quote}</q>}
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {c.publishedAt && <span>published {c.publishedAt}</span>}
                    {c.eventDate && <span>event {c.eventDate}</span>}
                    {c.sourceIds.map((id) => {
                      const url = urls.get(id);
                      return url ? (
                        <a
                          key={id}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-4 hover:underline"
                        >
                          {hostOf(url)}
                        </a>
                      ) : null;
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
