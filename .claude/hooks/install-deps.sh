#!/usr/bin/env bash
# SessionStart: bring this checkout up to date with origin's base branch (sync-base.sh), then
# install from the lockfile. pnpm is a fast no-op when nothing changed, and this also catches a
# lockfile that changed since the last session (e.g. main fast-forwarded from another worktree).
# Both run here, in order, because hooks of one event run in parallel.
hooks="$(cd "$(dirname "$0")" && pwd)"
source "$hooks/common.sh"
cd "$(checkout_root)" || exit 0
"$hooks/sync-base.sh" "$PWD"
[[ -f pnpm-lock.yaml ]] || exit 0
[[ -d node_modules ]] && fresh="" || fresh=1
if ! pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1; then
  echo "pnpm install failed in this checkout; run it manually before pnpm check." >&2
elif [[ -n "$fresh" ]]; then
  echo "Installed dependencies in this new checkout (pnpm install --frozen-lockfile)."
fi
exit 0
