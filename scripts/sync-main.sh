#!/usr/bin/env bash
# Fetch origin's base branch and fast-forward local `main` to it, so new worktrees and the main
# checkout start current. Fast-forward only: skipped if `main` has unpushed commits or its checkout
# has uncommitted changes. Run by the SessionStart hook; run it by hand after a PR merges.
# Usage: scripts/sync-main.sh [any checkout of this repo]
cd "${1:-$(dirname "$0")/..}" || exit 0
base="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
branch="${base#origin/}"
if ! GIT_TERMINAL_PROMPT=0 git fetch --quiet origin "$branch" 2>/dev/null; then
  echo "Could not fetch origin; local $branch may be behind $base." >&2
  exit 0
fi

git show-ref --verify --quiet "refs/heads/$branch" || exit 0
old="$(git rev-parse "$branch")"
[[ "$old" == "$(git rev-parse "$base")" ]] && exit 0
git merge-base --is-ancestor "$branch" "$base" || exit 0

# Where is the branch checked out? (empty if nowhere)
dir="$(git worktree list --porcelain | awk -v b="branch refs/heads/$branch" '/^worktree /{w=substr($0,10)} $0==b{print w}')"
if [[ -z "$dir" ]]; then
  git update-ref "refs/heads/$branch" "$base" "$old" || exit 0
elif [[ -z "$(git -C "$dir" status --porcelain)" ]]; then
  git -C "$dir" merge --ff-only --quiet "$base" >/dev/null 2>&1 || exit 0
else
  exit 0
fi
echo "Fast-forwarded local $branch to $base ($(git rev-list --count "$old..$base") new commits)."
