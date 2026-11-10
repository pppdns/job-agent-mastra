"use client";

import { DISCOVERY_SOURCE_LABELS, DISCOVERY_SOURCES } from "@copilot/shared";
import { useRouter } from "next/navigation";
import {
  type JobListParams,
  MIN_SCORE_OPTIONS,
  POSTED_WITHIN_OPTIONS,
  withParams,
} from "@/lib/job-list";

// Discovery filters for /jobs (source, minimum match score, posted within, unseen only). Each
// change navigates to the filtered list (URL state, first page).

const selectClass =
  "h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function JobFilters({ params }: { params: JobListParams }) {
  const router = useRouter();
  const go = (change: Partial<JobListParams>) =>
    router.replace(withParams(params, change), { scroll: false });
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-sm" aria-label="Filters">
      <select
        aria-label="Source"
        className={selectClass}
        value={params.source ?? ""}
        onChange={(e) =>
          go({ source: DISCOVERY_SOURCES.find((s) => s === e.target.value) ?? undefined })
        }
      >
        <option value="">All sources</option>
        {DISCOVERY_SOURCES.map((s) => (
          <option key={s} value={s}>
            {DISCOVERY_SOURCE_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        aria-label="Minimum match"
        className={selectClass}
        value={params.minScore ?? ""}
        onChange={(e) => go({ minScore: e.target.value ? Number(e.target.value) : undefined })}
      >
        <option value="">Any match</option>
        {MIN_SCORE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            Match ≥ {n}
          </option>
        ))}
      </select>
      <select
        aria-label="Posted within"
        className={selectClass}
        value={params.postedWithinDays ?? ""}
        onChange={(e) =>
          go({ postedWithinDays: e.target.value ? Number(e.target.value) : undefined })
        }
      >
        <option value="">Posted any time</option>
        {POSTED_WITHIN_OPTIONS.map((d) => (
          <option key={d} value={d}>
            Posted ≤ {d === 1 ? "1 day" : `${d} days`}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={params.unseen}
          onChange={(e) => go({ unseen: e.target.checked })}
          className="size-4 accent-primary"
        />
        Unseen only
      </label>
    </fieldset>
  );
}
