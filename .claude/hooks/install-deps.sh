#!/usr/bin/env bash
# SessionStart: bring this checkout up to date with origin's base branch (sync-base.sh), then
# install from the lockfile if node_modules is missing (fresh worktree) or the sync changed the lockfile.
# Both run here, in order, because hooks of one event run in parallel.
hooks="$(cd "$(dirname "$0")" && pwd)"
source "$hooks/common.sh"
cd "$(checkout_root)" || exit 0
lock_before="$(git rev-parse HEAD:pnpm-lock.yaml 2>/dev/null)"
"$hooks/sync-base.sh" "$PWD"
[[ -f pnpm-lock.yaml ]] || exit 0
[[ ! -d node_modules || "$lock_before" != "$(git rev-parse HEAD:pnpm-lock.yaml 2>/dev/null)" ]] || exit 0
if pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1; then
  echo "Installed dependencies in this checkout (pnpm install --frozen-lockfile)."
else
  echo "pnpm install failed in this checkout; run it manually before pnpm check." >&2
fi
exit 0
