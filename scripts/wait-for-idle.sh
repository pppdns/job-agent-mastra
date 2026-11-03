#!/usr/bin/env bash
# Waits until the machine has room for a heavy task (pnpm eval, pnpm e2e, builds), because agents in
# other worktrees may be running theirs: heavy tasks queue instead of making each other flaky.
# Busy = 1-minute load >= 0.75 x CPUs, free memory < 20%, or another eval/e2e run in progress.
# Usage: scripts/wait-for-idle.sh [max-wait-seconds, default 1800] && pnpm eval
# Exits 1 if still busy after max-wait (then report it rather than run anyway).
set -euo pipefail
max_wait="${1:-1800}"
cpus="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
waited=0

busy_reason() {
  local load free
  load="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || cut -d' ' -f1 /proc/loadavg)"
  if awk -v l="$load" -v c="$cpus" 'BEGIN { exit !(l >= 0.75 * c) }'; then
    echo "load $load on $cpus CPUs"
    return
  fi
  free="$(memory_pressure -Q 2>/dev/null | sed -nE 's/.*free percentage: ([0-9]+)%.*/\1/p')"
  if [[ -n "$free" ]] && ((free < 20)); then
    echo "only ${free}% memory free"
    return
  fi
  if pgrep -f 'vitest.eval.config|playwright test' >/dev/null; then
    echo "another eval/e2e run is in progress"
  fi
}

while reason="$(busy_reason)" && [[ -n "$reason" ]]; do
  if ((waited >= max_wait)); then
    echo "wait-for-idle: still busy after ${waited}s ($reason)" >&2
    exit 1
  fi
  echo "wait-for-idle: busy ($reason), checking again in 30s" >&2
  sleep 30
  waited=$((waited + 30))
done
echo "wait-for-idle: machine is idle enough, go ahead"
