#!/usr/bin/env bash
# SessionStart: in a linked worktree, claim this checkout's port slot and tell Claude its URLs.
# The main checkout uses the defaults (web 3000, agent 4111) and stays quiet.
source "$(dirname "$0")/common.sh"
root="$(checkout_root)"
[[ -x "$root/scripts/ports.sh" ]] || exit 0
ports="$("$root/scripts/ports.sh" 2>/dev/null)" || exit 0
[[ "$ports" == *"(slot 0)"* ]] && exit 0
echo "$ports. pnpm dev, e2e, eval:studio, agent:api and ngrok use them; run scripts/ports.sh to see them again."
exit 0
