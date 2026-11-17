// Time left of a running step, extrapolated linearly from its pace so far. Null while there is too
// little progress for the pace to mean anything.

const MIN_ELAPSED_MS = 30_000;
const MIN_DONE = 5;
const MIN_FRACTION = 0.01;

export function estimateRemainingMs({
  done,
  total,
  startedAt,
  now,
}: {
  done: number;
  total: number;
  startedAt: string | undefined;
  now: number;
}): number | null {
  if (!startedAt || done <= 0 || done >= total) return null;
  const elapsed = now - new Date(startedAt).getTime();
  if (!(elapsed >= MIN_ELAPSED_MS) || done < MIN_DONE || done / total < MIN_FRACTION) return null;
  return (elapsed / done) * (total - done);
}

/** An estimate in round terms: "under a minute", "34m", "2h 5m". */
export function formatRemaining(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
