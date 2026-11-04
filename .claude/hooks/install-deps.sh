#!/usr/bin/env bash
# SessionStart: bring a fresh worktree up to date with origin's base branch (sync-base.sh), then,
# since a fresh worktree has no node_modules, install from the lockfile so checks and hooks work.
# Both run here, in order, because hooks of one event run in parallel.
hooks="$(cd "$(dirname "$0")" && pwd)"
source "$hooks/common.sh"
cd "$(checkout_root)" || exit 0
"$hooks/sync-base.sh" "$PWD"
[[ -f pnpm-lock.yaml && ! -d node_modules ]] || exit 0
if pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1; then
  echo "Installed dependencies in this new checkout (pnpm install --frozen-lockfile)."
else
  echo "pnpm install failed in this checkout; run it manually before pnpm check." >&2
fi
exit 0
