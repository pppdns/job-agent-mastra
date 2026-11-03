"use client";

import type { RunEvent, UsageTotals } from "@copilot/db";
import { ActivityIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import type { ThreadUsageResponse } from "@/app/api/threads/[threadId]/usage/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Usage = ThreadUsageResponse;
type RunUsage = Usage["runs"][number];

const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 3)}`;
const ms = (n: number | null | undefined) =>
  n == null ? "n/a" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
const num = (n: number) => n.toLocaleString("en-GB");
const time = (d: string | Date) =>
  new Date(d).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const GROUPS: { title: string; match: (e: RunEvent) => boolean }[] = [
  { title: "LLM calls", match: (e) => e.type === "llm" },
  { title: "Search", match: (e) => e.type === "provider" && e.category === "search" },
  { title: "Extraction", match: (e) => e.type === "provider" && e.category === "extraction" },
  { title: "Browser", match: (e) => e.type === "provider" && e.category === "browser" },
  { title: "Tools", match: (e) => e.type === "tool" },
  {
    title: "Retries, errors, compaction",
    match: (e) => e.type === "retry" || e.type === "error" || e.type === "compaction",
  },
];

/** Run details for this chat, read from app tables on open. */
export function TechnicalPanel({ threadId }: { threadId: string }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    fetch(`/api/threads/${encodeURIComponent(threadId)}/usage`)
      .then((r) => (r.ok ? (r.json() as Promise<Usage>) : Promise.reject(r.status)))
      .then(setUsage)
      .catch(() => setFailed(true));
  };

  return (
    <Sheet onOpenChange={(open) => open && load()}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="ml-auto">
          <ActivityIcon />
          Technical details
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" aria-label="Technical details">
        <SheetHeader>
          <SheetTitle>Technical details</SheetTitle>
          <SheetDescription>
            Costs are estimates from a static price table (providers don&apos;t report cost). Each
            model or provider call is counted once.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          {failed && <p className="text-sm text-destructive">Couldn&apos;t load run details.</p>}
          {!usage && !failed && <p className="text-sm text-muted-foreground">Loading…</p>}
          {usage && (
            <>
              <section aria-label="Chat totals" className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">This chat ({usage.runs.length} runs)</h3>
                <Totals totals={usage.totals} />
                {usage.approvals.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Approvals:{" "}
                    {usage.approvals
                      .map((a) => `${a.kind.replace("_", " ")} ${a.status} (${time(a.createdAt)})`)
                      .join(" · ")}
                  </p>
                )}
              </section>
              {usage.runs.map((run, i) => (
                <RunDetails
                  key={run.id}
                  run={run}
                  studioUrl={usage.studioUrl}
                  defaultOpen={i === 0}
                />
              ))}
              {usage.runs.length === 0 && (
                <p className="text-sm text-muted-foreground">No runs in this chat yet.</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Totals({ totals: t }: { totals: UsageTotals }) {
  const rows: [string, string][] = [
    ["Model calls", num(t.llmCalls)],
    [
      "Input tokens",
      `${num(t.inputTokens)} (cached ${num(t.cachedInputTokens)}, cache write ${num(t.cacheWriteTokens)})`,
    ],
    ["Output tokens", `${num(t.outputTokens)} (reasoning ${num(t.reasoningTokens)})`],
    ["Est. LLM cost", usd(t.estimatedLlmUsd)],
    [
      "Web calls",
      `search ${t.providerCalls.search} · extraction ${t.providerCalls.extraction} · browser ${t.providerCalls.browser}`,
    ],
    ["Est. external cost", usd(t.estimatedProviderUsd)],
    [
      "Tool calls · retries · errors · compactions",
      `${t.toolCalls} · ${t.retries} · ${t.errors} · ${t.compactions}`,
    ],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RunDetails({
  run,
  studioUrl,
  defaultOpen,
}: {
  run: RunUsage;
  studioUrl: string;
  defaultOpen: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border p-3" aria-label="Run">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CollapsibleTrigger asChild>
          <Button variant="link" size="sm" className="h-auto px-0 font-mono">
            run {run.id.slice(0, 8)}
          </Button>
        </CollapsibleTrigger>
        <Badge variant={run.status === "completed" ? "secondary" : "outline"}>{run.status}</Badge>
        <span className="text-muted-foreground">
          {time(run.startedAt)} · total {ms(run.durationMs)} · first text {ms(run.ttftMs)} ·{" "}
          {run.model ?? "model n/a"} via AI Gateway · Mastra
        </span>
        {run.traceId ? (
          <a
            href={`${studioUrl}/traces?traceId=${encodeURIComponent(run.traceId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            Studio trace <ExternalLinkIcon className="size-3" />
          </a>
        ) : (
          <span className="text-muted-foreground">no trace id</span>
        )}
      </div>
      <CollapsibleContent className="flex flex-col gap-4 pt-3">
        <Totals totals={run.totals} />
        {run.error && <p className="text-sm text-destructive">Error: {run.error}</p>}
        {GROUPS.map((g) => {
          const events = run.events.filter(g.match);
          return events.length === 0 ? null : (
            <EventTable key={g.title} title={g.title} events={events} />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

function EventTable({ title, events }: { title: string; events: RunEvent[] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>What</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="text-right">Tokens in/out</TableHead>
            <TableHead className="text-right">Est.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="max-w-72">
                <div className="truncate">
                  {e.actor ? `${e.actor} · ` : ""}
                  {e.name}
                </div>
                {e.data && <Detail data={e.data} />}
              </TableCell>
              <TableCell>{e.status}</TableCell>
              <TableCell>{ms(e.durationMs)}</TableCell>
              <TableCell className="text-right">
                {e.type === "llm"
                  ? `${num(e.inputTokens ?? 0)} / ${num(e.outputTokens ?? 0)}${e.cachedInputTokens ? ` (${num(e.cachedInputTokens)} cached)` : ""}`
                  : ""}
              </TableCell>
              <TableCell className="text-right">
                {e.estimatedUsd != null ? usd(e.estimatedUsd) : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** Sanitized arguments/results (secrets redacted, page text omitted at record time). */
function Detail({ data }: { data: Record<string, unknown> }) {
  const short = (data.query as string) ?? (data.url as string);
  if (short) return <div className="truncate text-xs text-muted-foreground">{short}</div>;
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">
        details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
