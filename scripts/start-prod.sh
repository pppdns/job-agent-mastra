#!/usr/bin/env bash
# Container entrypoint (Dockerfile CMD): starts the agent (loopback only, with Studio) and the
# web app (public), then exits as soon as either stops, so Fly restarts the machine.
# Migrations run on first database use in both processes; nothing to do here.
set -euo pipefail
cd "$(dirname "$0")/.."

missing=()
for name in APP_PASSWORD AGENT_SHARED_SECRET DATABASE_URL; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
[[ "${LLM_MODE:-live}" == "mock" || -n "${AI_GATEWAY_API_KEY:-}" ]] || missing+=(AI_GATEWAY_API_KEY)
if ((${#missing[@]})); then
  echo "start-prod: missing required env: ${missing[*]} (set them with fly secrets)" >&2
  exit 1
fi
if ((${#APP_PASSWORD} < 12)); then
  echo "start-prod: APP_PASSWORD must be at least 12 characters" >&2
  exit 1
fi
db="${DATABASE_URL#file:}"
mkdir -p "$(dirname "$db")"

# One-shot import (docs/deploy.md): an uploaded <db>.import replaces the database before any
# process opens it; the previous file is kept as <db>.before-import.
if [[ -f "$db.import" ]]; then
  [[ -f "$db" ]] && mv "$db" "$db.before-import"
  rm -f "$db-wal" "$db-shm"
  mv "$db.import" "$db"
  echo "start-prod: imported $db.import"
fi

(cd apps/agent/.mastra/output && exec node index.mjs) &
(cd apps/web && exec node_modules/.bin/next start --hostname 0.0.0.0 --port "${WEB_PORT:-3000}") &

# Bash as PID 1 ignores SIGTERM unless trapped: forward Fly's stop signal so both servers close
# the database cleanly instead of being killed after the timeout.
stop() {
  kill -TERM $(jobs -p) 2>/dev/null || true
  wait
  exit 0
}
trap stop TERM INT

wait -n
echo "start-prod: a server exited; stopping" >&2
kill -TERM $(jobs -p) 2>/dev/null || true
wait
exit 1
