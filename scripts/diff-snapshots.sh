#!/usr/bin/env bash
#
# Compare two snapshots captured by snapshot-working-folder.sh.
# Reports:
#   - Files added in B that weren't in A
#   - Files removed (in A, missing from B)
#   - Files whose content changed (hash differs)
#
# Usage:
#
#   scripts/diff-snapshots.sh <snapshot-A> <snapshot-B>
#
# A is treated as the "before" and B as the "after". Use this after
# round-trip steps in docs/COMPAT-TEST.md to identify regressions.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <snapshot-A> <snapshot-B>" >&2
  exit 1
fi

a="$1"
b="$2"

for snap in "$a" "$b"; do
  if [[ ! -f "$snap/tree.txt" || ! -f "$snap/hashes.txt" ]]; then
    echo "error: '$snap' isn't a valid snapshot (missing tree.txt or hashes.txt)" >&2
    exit 1
  fi
done

a_name="$(basename "$a")"
b_name="$(basename "$b")"

echo "Comparing snapshots:"
echo "  A: $a_name  ($(wc -l < "$a/tree.txt" | tr -d ' ') files)"
echo "  B: $b_name  ($(wc -l < "$b/tree.txt" | tr -d ' ') files)"
echo

# Files present only in B (added) and only in A (removed).
added="$(comm -13 <(sort "$a/tree.txt") <(sort "$b/tree.txt"))"
removed="$(comm -23 <(sort "$a/tree.txt") <(sort "$b/tree.txt"))"

if [[ -n "$added" ]]; then
  echo "Added in B:"
  printf '  %s\n' $added
  echo
fi
if [[ -n "$removed" ]]; then
  echo "Removed (in A, missing from B):"
  printf '  %s\n' $removed
  echo
fi

# Files in both, but with different hashes. Joins the hash files on
# the path column (cut -d' ' -f3-).
common_a=$(mktemp)
common_b=$(mktemp)
trap 'rm -f "$common_a" "$common_b"' EXIT
# hash line is: "<sha>  <path>" — two spaces separate. Sort by path so
# join lines up.
awk '{ hash = $1; $1 = ""; sub(/^ +/, ""); print $0 "\t" hash }' \
  "$a/hashes.txt" | sort > "$common_a"
awk '{ hash = $1; $1 = ""; sub(/^ +/, ""); print $0 "\t" hash }' \
  "$b/hashes.txt" | sort > "$common_b"

changed=$(join -t $'\t' "$common_a" "$common_b" \
  | awk -F '\t' '$2 != $3 { print $1 }')

if [[ -n "$changed" ]]; then
  echo "Content changed (same path, different hash):"
  printf '  %s\n' $changed
  echo
fi

if [[ -z "$added" && -z "$removed" && -z "$changed" ]]; then
  echo "No differences. The working folder is byte-identical between snapshots."
fi
