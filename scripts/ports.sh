#!/usr/bin/env bash
# Per-checkout dev ports, so the stacks of several git worktrees can run at the same time.
# The main checkout is slot 0 (web 3000, agent 4111). A linked worktree claims the lowest slot
# that no other checkout holds and whose ports are free, and keeps it in its gitignored .dev-ports.
# Slot k: web 3000+10k, agent 4111+10k, e2e web 3001+10k, e2e agent 4112+10k.
# Usage: scripts/ports.sh            prints this checkout's ports
#        scripts/ports.sh <cmd...>   runs cmd with WEB_PORT, AGENT_PORT, E2E_WEB_PORT, E2E_AGENT_PORT
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd -P)"

slot_of() { [[ -f "$1/.dev-ports" ]] && grep -E '^SLOT=[0-9]+$' "$1/.dev-ports" | cut -d= -f2 || true; }
in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
slot_busy() {
  local k=$1 p
  [[ "$claimed" == *" $k "* ]] && return 0
  for p in $((3000 + 10 * k)) $((3001 + 10 * k)) $((4111 + 10 * k)) $((4112 + 10 * k)); do
    in_use "$p" && return 0
  done
  return 1
}

git_dir="$(git -C "$root" rev-parse --path-format=absolute --git-dir)"
common_dir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)"
if [[ "$git_dir" == "$common_dir" ]]; then
  slot=0
else
  slot="$(slot_of "$root")"
  if [[ -z "$slot" ]]; then
    claimed=" "
    while IFS= read -r line; do
      [[ "$line" == "worktree "* ]] || continue
      dir="${line#worktree }"
      [[ "$dir" -ef "$root" ]] || claimed+="$(slot_of "$dir") "
    done < <(git -C "$root" worktree list --porcelain)
    slot=1
    while slot_busy "$slot"; do
      slot=$((slot + 1))
      ((slot <= 50)) || { echo "ports.sh: no free port slot" >&2; exit 1; }
    done
    printf 'SLOT=%s\n' "$slot" >"$root/.dev-ports"
  fi
fi

export WEB_PORT=$((3000 + 10 * slot)) AGENT_PORT=$((4111 + 10 * slot))
export E2E_WEB_PORT=$((WEB_PORT + 1)) E2E_AGENT_PORT=$((AGENT_PORT + 1))
(($#)) && exec "$@"
printf 'Dev ports (slot %s): web http://127.0.0.1:%s, agent + Studio http://127.0.0.1:%s, e2e web %s / agent %s\n' \
  "$slot" "$WEB_PORT" "$AGENT_PORT" "$E2E_WEB_PORT" "$E2E_AGENT_PORT"
