#!/usr/bin/env bash
# Stop: run `pnpm check` in the session's checkout; on failure, block once and hand the errors back to Claude.
source "$(dirname "$0")/common.sh"
[[ "$(json_field stop_hook_active)" == "true" ]] && exit 0
cd "$(checkout_root)" || exit 0
[[ -f package.json ]] || exit 0
if ! output="$(pnpm -s check 2>&1)"; then
  printf 'pnpm check failed — fix before finishing:\n%s\n' "$(printf '%s' "$output" | tail -40)" >&2
  exit 2
fi
exit 0
