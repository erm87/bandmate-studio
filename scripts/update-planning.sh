#!/usr/bin/env bash
# One-command workflow for planning-doc edits that bypass the per-PR
# version-bump + CHANGELOG ceremony. Pairs with the allowlist exception in
# scripts/check-changelog-entry.mjs.
#
# Usage:
#   scripts/update-planning.sh                       # default commit msg
#   scripts/update-planning.sh "Capture export idea" # custom commit msg
#   scripts/update-planning.sh --dry-run             # show planned ops, no execution
#   scripts/update-planning.sh --dry-run "msg"       # combined
#
# Behavior:
#   - Must be run from `main` with uncommitted changes in the working tree.
#   - Every staged-or-modified file MUST be in the planning allowlist
#     (BACKLOG.md, docs/HYGIENE-PLAN.md, docs/CLEANUP-PLAN.md, docs/archive/*).
#     Anything else and the script aborts before touching git state.
#   - Creates a `docs/planning-<unix-ts>` branch, commits the allowlisted
#     paths, pushes, opens a PR, enables --auto squash-merge, returns to main.
#
# The allowlist is read from scripts/lib/planning-paths.mjs so it stays
# in lockstep with check-changelog-entry.mjs's skip rule.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

dry_run=0
msg=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    *) msg="$arg" ;;
  esac
done
msg="${msg:-Update planning docs}"

run() {
  if [[ $dry_run -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

# --- Pre-flight checks (always run, even in dry-run) ---------------------

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "main" ]]; then
  echo "update-planning: must be run from 'main' (currently on '$current_branch')" >&2
  exit 1
fi

# Working tree must have uncommitted changes (staged or unstaged).
if git diff --quiet && git diff --cached --quiet; then
  echo "update-planning: no uncommitted changes — nothing to do" >&2
  exit 1
fi

# Collect every path that has any modification (staged, unstaged, or untracked).
# `git status --porcelain` reports them all in a single pass.
# (Plain `while read` for bash 3.2 compatibility — macOS default has no mapfile.)
touched=()
while IFS= read -r line; do
  # Porcelain format: XY <path> OR XY <old> -> <new> (renames).
  # We want the destination path in both cases.
  if [[ "$line" == *" -> "* ]]; then
    path="${line#* -> }"
  else
    path="${line:3}"
  fi
  touched+=("$path")
done < <(git status --porcelain)

if [[ ${#touched[@]} -eq 0 ]]; then
  echo "update-planning: no changed files detected" >&2
  exit 1
fi

# Hand the list to the shared allowlist checker. Non-allowlist files abort.
if ! offenders="$(node scripts/lib/planning-paths.mjs check "${touched[@]}")"; then
  echo "update-planning: non-allowlist files staged or modified — aborting." >&2
  echo "" >&2
  echo "Offenders:" >&2
  while IFS= read -r line; do echo "  $line" >&2; done <<< "$offenders"
  echo "" >&2
  echo "The fast lane is only for: $(node scripts/lib/planning-paths.mjs list | tr '\n' ' ')" >&2
  echo "Use the regular branch + bump:patch|minor + CHANGELOG workflow for anything else." >&2
  exit 1
fi

# --- Plan + execute ------------------------------------------------------

branch="docs/planning-$(date +%s)"

echo "update-planning: commit message: $msg"
echo "update-planning: branch:         $branch"
echo "update-planning: changed paths:"
for p in "${touched[@]}"; do echo "  $p"; done
echo ""

run "git checkout -b \"$branch\""

# Stage allowlist paths only. The check above already guaranteed the
# touched set is a subset of the allowlist, but we still `git add` per
# entry rather than `git add -A` so any future expansion of "touched"
# stays explicit.
while IFS= read -r entry; do
  run "git add \"$entry\" 2>/dev/null || true"
done < <(node scripts/lib/planning-paths.mjs list)

# Bail if nothing staged after the add pass (defensive — shouldn't trigger
# given the pre-flight, but cheap insurance).
if [[ $dry_run -eq 0 ]]; then
  if git diff --cached --quiet; then
    echo "update-planning: nothing staged after add — aborting" >&2
    git checkout main
    git branch -D "$branch" >/dev/null 2>&1 || true
    exit 1
  fi
fi

run "git commit -m \"$msg\""
run "git push -u origin \"$branch\""
run "gh pr create --fill --title \"$msg\" --body \"Planning-only change; CI version/changelog checks auto-skip.\""
run "gh pr merge --squash --delete-branch --auto"
run "git checkout main"
run "git pull"

if [[ $dry_run -eq 1 ]]; then
  echo ""
  echo "update-planning: dry-run complete. No git state was changed."
fi
