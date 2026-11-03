#!/usr/bin/env bash
# Stops this checkout's dev servers (pnpm dev, eval:studio, leftover e2e stacks): every process
# listening on its port slot (scripts/ports.sh). Other checkouts' servers are never touched.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
pids="$("$root/scripts/ports.sh" bash -c \
  'for p in $WEB_PORT $AGENT_PORT $E2E_WEB_PORT $E2E_AGENT_PORT; do lsof -t -nP -iTCP:$p -sTCP:LISTEN || true; done' |
  sort -u)"
if [[ -z "$pids" ]]; then
  echo "stop-dev: no dev servers running in this checkout"
  exit 0
fi
# shellcheck disable=SC2086 # one PID per word
kill $pids
echo "stop-dev: stopped $(wc -w <<<"$pids" | tr -d ' ') server process(es); $("$root/scripts/ports.sh")"
