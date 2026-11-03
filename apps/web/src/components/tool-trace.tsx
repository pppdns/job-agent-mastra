import { FileTextIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";

/** A tool part from a UI message (`tool-<name>`), as streamed or reloaded from history. */
export type ToolPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export const isToolPart = (part: { type: string }): part is ToolPart =>
  part.type.startsWith("tool-");

/**
 * A successful snapshot or profile proposal renders as an approval prompt instead of a trace
 * row. A draft that was already approved (possibly in another chat) has nothing to decide.
 */
export function proposedApprovalId(part: ToolPart): string | undefined {
  const proposes =
    part.type === "tool-propose_job_snapshot" || part.type === "tool-propose_profile_change";
  if (!proposes || part.state !== "output-available") return;
  const output = part.output as { ok?: boolean; approvalId?: string; status?: string } | undefined;
  return output?.ok && output.status !== "approved" ? output.approvalId : undefined;
}

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
  const running: Record<string, string> = {
    ingest_listing: "Reading the listing",
    save_job_draft: "Saving the draft",
    propose_job_snapshot: "Preparing the snapshot",
    propose_profile_change: "Preparing a profile change",
    find_saved_jobs: "Searching saved jobs",
    get_job: "Loading a saved job",
    updateWorkingMemory: "Noting this for this chat",
    research_company: "Researching",
  };
  if (part.state === "output-error") {
    return <Line status="error" title={`Failed to run ${name}`} description={part.errorText} />;
  }
  if (part.state !== "output-available") {
    return <Line status="running" title={running[name] ?? `Running ${name}`} />;
  }
  if (name === "save_job_draft" || name === "propose_job_snapshot") {
    const output = (part.output ?? {}) as {
      ok?: boolean;
      version?: number;
      draftVersion?: number;
      status?: string;
      error?: string;
    };
    if (output.ok === false) {
      const what = name === "save_job_draft" ? "Draft not saved" : "Snapshot not proposed";
      return <Line status="error" title={what} description={output.error} />;
    }
    if (name === "save_job_draft") {
      return <Line title={`Saved draft v${output.version}`} description="not approved" />;
    }
    return output.status === "approved" ? (
      <Line title={`Draft v${output.draftVersion} is already approved`} />
    ) : (
      <Line title="Proposed a snapshot for approval" />
    );
  }
  if (name === "propose_profile_change") {
    const output = (part.output ?? {}) as { error?: string };
    return <Line status="error" title="Profile change not proposed" description={output.error} />;
  }
  if (name === "updateWorkingMemory") {
    return <Line title="Noted for this chat only" description="not added to your profile" />;
  }
  if (name === "find_saved_jobs") {
    const output = (part.output ?? {}) as { matches?: unknown[] };
    return (
      <Line title={`Searched saved jobs`} description={`${output.matches?.length ?? 0} found`} />
    );
  }
  if (name === "get_job") {
    const output = (part.output ?? {}) as {
      job?: { title?: string; company?: string };
      profileStale?: boolean;
    };
    const what = [output.job?.title, output.job?.company].filter(Boolean).join(" · ");
    return (
      <Line
        title="Loaded saved job"
        description={`${what}${output.profileStale ? " · assessed with an older profile" : ""}`}
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
