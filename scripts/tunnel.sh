#!/usr/bin/env bash
# Exposes the local web app (127.0.0.1:$WEB_PORT, default 3000) through an ngrok tunnel.
# The app has no login of its own, so the tunnel is always behind HTTP basic auth:
# NGROK_BASIC_AUTH=user:password (>= 8 char password) lives in apps/web/.env.local;
# it is generated and shown once if missing. Only the web app is exposed, never the agent.
# Optional: NGROK_DOMAIN=my-name.ngrok-free.dev to use a reserved domain.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
web_env="$root/apps/web/.env.local"
touch "$web_env"
chmod 600 "$web_env"

command -v ngrok >/dev/null || { echo "ngrok not found: brew install ngrok, then ngrok config add-authtoken <token>" >&2; exit 1; }

value_of() { grep -E "^$1=" "$web_env" | tail -1 | cut -d= -f2- || true; }

auth="${NGROK_BASIC_AUTH:-$(value_of NGROK_BASIC_AUTH)}"
if [[ -z "$auth" ]]; then
  auth="copilot:$(openssl rand -hex 12)"
  printf '\nNGROK_BASIC_AUTH=%s\n' "$auth" >>"$web_env"
  echo "Generated tunnel login (saved in apps/web/.env.local): $auth" >&2
fi
[[ "$auth" =~ ^[^:]+:.{8,}$ ]] || { echo "NGROK_BASIC_AUTH must look like user:password (password >= 8 chars)" >&2; exit 1; }

domain="${NGROK_DOMAIN:-$(value_of NGROK_DOMAIN)}"
args=(http "127.0.0.1:${WEB_PORT:-3000}" --basic-auth "$auth")
[[ -n "$domain" ]] && args+=(--url "$domain")
exec ngrok "${args[@]}"
