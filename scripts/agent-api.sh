#!/usr/bin/env bash
# `mastra api` against the local agent server with the shared-secret header.
# Usage: pnpm agent:api agent run copilot '{"messages":"hi"}'
#        pnpm agent:api trace list '{"page":0,"perPage":5}'
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${AGENT_SHARED_SECRET:-}" && -f "$root/apps/agent/.env" ]]; then
  AGENT_SHARED_SECRET="$(grep -E '^AGENT_SHARED_SECRET=' "$root/apps/agent/.env" | tail -1 | cut -d= -f2- || true)"
fi
: "${AGENT_SHARED_SECRET:?set AGENT_SHARED_SECRET or add it to apps/agent/.env}"
cd "$root/apps/agent"
exec pnpm exec mastra api --url "http://127.0.0.1:${AGENT_PORT:-4111}" \
  --header "Authorization: Bearer $AGENT_SHARED_SECRET" "$@"
