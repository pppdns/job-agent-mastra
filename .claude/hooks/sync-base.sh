#!/usr/bin/env bash
# Called by install-deps.sh at SessionStart, before installing (hooks in one event run in parallel).
# Worktrees branch from a local ref (origin/main for desktop sessions, local HEAD for `claude -w`)
# that may be stale. In a fresh worktree (clean tree, branch not pushed yet), fetch origin and
# fast-forward to the base branch. Never merges, resets or touches the main checkout's branch.
# Usage: sync-base.sh <checkout root>
cd "${1:?checkout root}" || exit 0

# Only linked worktrees; the main checkout is left alone.
[[ "$(git rev-parse --git-dir 2>/dev/null)" != "$(git rev-parse --git-common-dir 2>/dev/null)" ]] || exit 0
# Only fresh branches: no upstream yet and nothing uncommitted.
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 && exit 0
[[ -z "$(git status --porcelain 2>/dev/null)" ]] || exit 0

base="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
if ! GIT_TERMINAL_PROMPT=0 git fetch --quiet origin "${base#origin/}" 2>/dev/null; then
  echo "Could not fetch origin; this worktree may be behind $base." >&2
  exit 0
fi

head="$(git rev-parse HEAD)"
[[ "$head" == "$(git rev-parse "$base")" ]] && exit 0
# Fast-forward only when HEAD is an ancestor of the base (no commits of its own on this branch).
git merge-base --is-ancestor HEAD "$base" || exit 0
if git merge --ff-only --quiet "$base" >/dev/null 2>&1; then
  echo "Fast-forwarded this new worktree to $base ($(git rev-list --count "$head..HEAD") new commits)."
fi
exit 0
