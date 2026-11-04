#!/usr/bin/env bash
# Called by install-deps.sh at SessionStart, before installing (hooks in one event run in parallel).
# Fetches origin and fast-forwards local `main` (scripts/sync-main.sh). Worktrees branch from a
# local ref that may have been stale, so a fresh worktree (on a branch, clean, not pushed yet, no
# commits of its own) is also fast-forwarded to the base branch. Never merges or resets.
# Usage: sync-base.sh <checkout root>
cd "${1:?checkout root}" || exit 0
sync="$(dirname "$0")/../../scripts/sync-main.sh"
[[ -x "$sync" ]] && "$sync" "$PWD"

# The rest only for fresh linked worktrees on a branch (not detached HEAD, e.g. during a bisect).
git symbolic-ref -q HEAD >/dev/null || exit 0
[[ "$(git rev-parse --git-dir 2>/dev/null)" != "$(git rev-parse --git-common-dir 2>/dev/null)" ]] || exit 0
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 && exit 0
[[ -z "$(git status --porcelain 2>/dev/null)" ]] || exit 0

base="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
head="$(git rev-parse HEAD)"
[[ "$head" == "$(git rev-parse "$base")" ]] && exit 0
git merge-base --is-ancestor HEAD "$base" || exit 0
if git merge --ff-only --quiet "$base" >/dev/null 2>&1; then
  echo "Fast-forwarded this new worktree to $base ($(git rev-list --count "$head..HEAD") new commits)."
fi
exit 0
