#!/usr/bin/env bash
# Sets the Fly app's secrets (app from fly.toml) without printing any value:
# - APP_PASSWORD: asked for here (the web login; at least 12 characters)
# - AGENT_SHARED_SECRET: freshly generated (production never shares the local one)
# - AI_GATEWAY_API_KEY, TAVILY_API_KEY, FIRECRAWL_API_KEY: copied from apps/agent/.env
# Running it again rotates the password and the shared secret (signs you out) and restarts
# the machine. Run it in your own terminal: `pnpm fly:secrets`.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
agent_env="$root/apps/agent/.env"
command -v fly >/dev/null || export PATH="$HOME/.fly/bin:$PATH"
command -v fly >/dev/null || { echo "fly not found: curl -L https://fly.io/install.sh | sh" >&2; exit 1; }
[[ -f "$agent_env" ]] || { echo "missing apps/agent/.env (pnpm setup:env)" >&2; exit 1; }

# Last assignment wins; surrounding quotes are dropped.
value_of() {
  local v
  v="$(grep -E "^$1=" "$agent_env" | tail -1 | cut -d= -f2- || true)"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

read -rsp "Web login password (min 12 characters): " password; echo
read -rsp "Repeat it: " again; echo
[[ "$password" == "$again" ]] || { echo "passwords differ" >&2; exit 1; }
((${#password} >= 12)) || { echo "password too short" >&2; exit 1; }
[[ "$password" != *$'\n'* ]] || { echo "password must be one line" >&2; exit 1; }

names=(APP_PASSWORD AGENT_SHARED_SECRET)
for name in AI_GATEWAY_API_KEY TAVILY_API_KEY FIRECRAWL_API_KEY; do
  if [[ -n "$(value_of "$name")" ]]; then names+=("$name"); else
    echo "note: $name is not set in apps/agent/.env; skipped" >&2
  fi
done

{
  printf 'APP_PASSWORD=%s\n' "$password"
  printf 'AGENT_SHARED_SECRET=%s\n' "$(openssl rand -hex 24)"
  for name in "${names[@]:2}"; do printf '%s=%s\n' "$name" "$(value_of "$name")"; done
} | (cd "$root" && fly secrets import)
echo "set on Fly: ${names[*]}"
