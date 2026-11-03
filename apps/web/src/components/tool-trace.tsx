import { FileTextIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";

/** A tool part from a UI message (`tool-<name>`), as streamed or reloaded from history. */
export type ToolPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: string;
  output?: unknown;
  errorText?: string;
};

export const isToolPart = (part: { type: string }): part is ToolPart =>
  part.type.startsWith("tool-");

const SOURCE_LABELS: Record<string, string> = {
  linkedin: "the LinkedIn listing",
  ats: "the employer's job posting",
  web: "the web page",
  pasted: "your pasted text",
};

type IngestOutput = {
  status?: string;
  reason?: string;
  complete?: boolean;
  source?: { kind?: string; url?: string | null };
  listing?: { title?: string; company?: string };
};

/** One trace row per tool call: what ran and, for listings, which source was actually read. */
export function ToolTrace({ parts }: { parts: ToolPart[] }) {
  return (
    <Trace>
      {parts.map((part) => (
        <ToolLine key={part.toolCallId} part={part} />
      ))}
    </Trace>
  );
}

function ToolLine({ part }: { part: ToolPart }) {
  const name = part.type.slice("tool-".length);
  if (part.state === "output-error") {
    return <Line status="error" title={`Failed to run ${name}`} description={part.errorText} />;
  }
  if (part.state !== "output-available") {
    return (
      <Line
        status="running"
        title={name === "ingest_listing" ? "Reading the listing" : `Running ${name}`}
      />
    );
  }
  if (name !== "ingest_listing") return <Line title={`Ran ${name}`} />;

  const output = (part.output ?? {}) as IngestOutput;
  if (output.status === "saved") {
    const what = [output.listing?.title, output.listing?.company].filter(Boolean).join(" · ");
    const source = SOURCE_LABELS[output.source?.kind ?? ""] ?? "the listing";
    return (
      <Line
        title={`Read ${source}${output.complete === false ? " (may be incomplete)" : ""}`}
        description={what || output.source?.url || undefined}
      />
    );
  }
  return (
    <Line
      status={output.status === "blocked" ? "error" : undefined}
      title={
        output.status === "blocked" ? "Didn't open the link" : "Couldn't read the full listing"
      }
      description={output.reason}
    />
  );
}

function Line({
  title,
  description,
  status,
}: {
  title: string;
  description?: string;
  status?: "running" | "error";
}) {
  return (
    <TraceLine status={status}>
      <TraceIcon>
        <FileTextIcon />
      </TraceIcon>
      <TraceTitle>{title}</TraceTitle>
      {description && <TraceDescription>{description}</TraceDescription>}
    </TraceLine>
  );
}
