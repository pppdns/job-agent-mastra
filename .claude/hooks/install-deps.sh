#!/usr/bin/env bash
# SessionStart: a fresh worktree has no node_modules; install from the lockfile so checks and hooks work.
source "$(dirname "$0")/common.sh"
cd "$(checkout_root)" || exit 0
[[ -f pnpm-lock.yaml && ! -d node_modules ]] || exit 0
if pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1; then
  echo "Installed dependencies in this new checkout (pnpm install --frozen-lockfile)."
else
  echo "pnpm install failed in this checkout; run it manually before pnpm check." >&2
fi
exit 0
