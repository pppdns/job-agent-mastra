#!/usr/bin/env bash
# Stop: run `pnpm check` in the session's checkout, then look for unpushed commits; on either, block once and tell Claude.
source "$(dirname "$0")/common.sh"
[[ "$(json_field stop_hook_active)" == "true" ]] && exit 0
cd "$(checkout_root)" || exit 0
[[ -f package.json ]] || exit 0
if ! output="$(pnpm -s check 2>&1)"; then
  printf 'pnpm check failed — fix before finishing:\n%s\n' "$(printf '%s' "$output" | tail -40)" >&2
  exit 2
fi
# Commits on the current branch that no remote branch has yet (skipped on a detached HEAD).
if branch="$(git symbolic-ref --quiet --short HEAD)"; then
  unpushed="$(git rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)"
  if (( unpushed > 0 )); then
    printf '%s unpushed commit(s) on %s — push them (AGENTS.md: push after every commit; first push: git push -u origin HEAD).\n' "$unpushed" "$branch" >&2
    exit 2
  fi
fi
exit 0
