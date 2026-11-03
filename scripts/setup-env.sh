#!/usr/bin/env bash
# Creates/extends local env files without printing or overwriting any existing value:
# - apps/agent/.env: adds AGENT_SHARED_SECRET (random) if missing
# - apps/web/.env.local: adds the same AGENT_SHARED_SECRET if missing
# Ports are per checkout (scripts/ports.sh), so no URL or port is written here.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
agent_env="$root/apps/agent/.env"
web_env="$root/apps/web/.env.local"
touch "$agent_env" "$web_env"
chmod 600 "$agent_env" "$web_env"

value_of() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- || true; }

secret="$(value_of AGENT_SHARED_SECRET "$agent_env")"
if [[ -z "$secret" ]]; then
  secret="$(openssl rand -hex 24)"
  printf '\nAGENT_SHARED_SECRET=%s\n' "$secret" >>"$agent_env"
  echo "added AGENT_SHARED_SECRET to apps/agent/.env"
fi

if [[ -z "$(value_of AGENT_SHARED_SECRET "$web_env")" ]]; then
  printf 'AGENT_SHARED_SECRET=%s\n' "$secret" >>"$web_env"
  echo "added AGENT_SHARED_SECRET to apps/web/.env.local"
elif [[ "$(value_of AGENT_SHARED_SECRET "$web_env")" != "$secret" ]]; then
  echo "warning: AGENT_SHARED_SECRET differs between apps/agent/.env and apps/web/.env.local" >&2
fi

grep -qE '^AI_GATEWAY_API_KEY=.+' "$agent_env" || echo "reminder: set AI_GATEWAY_API_KEY in apps/agent/.env (or LLM_MODE=mock)"
