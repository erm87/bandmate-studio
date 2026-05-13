#!/usr/bin/env bash
#
# Capture a BandMate working folder's complete state as a snapshot
# for backwards-compatibility round-trip testing. Writes:
#
#   <snapshot-dir>/tree.txt    — sorted list of every file (relative paths)
#   <snapshot-dir>/hashes.txt  — sha256 per file, sorted by path
#   <snapshot-dir>/meta.txt    — source folder, snapshot name, timestamp
#
# Usage:
#
#   scripts/snapshot-working-folder.sh <working-folder> [snapshot-name]
#
# If <snapshot-name> is omitted, defaults to `snapshot-<UTC timestamp>`.
# Snapshot lives in the *parent* of the working folder (so it doesn't
# pollute the folder being snapshotted).
#
# Use diff-snapshots.sh to compare two snapshots side by side. The
# overall protocol is documented in docs/COMPAT-TEST.md.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <working-folder> [snapshot-name]" >&2
  exit 1
fi

folder="$1"
name="${2:-snapshot-$(date -u +%Y%m%d-%H%M%S)}"

if [[ ! -d "$folder" ]]; then
  echo "error: '$folder' is not a directory" >&2
  exit 1
fi

# Absolute path so the snapshot is reusable regardless of cwd.
abs_folder="$(cd "$folder" && pwd)"
parent_dir="$(dirname "$abs_folder")"
out_dir="$parent_dir/$name"

if [[ -e "$out_dir" ]]; then
  echo "error: '$out_dir' already exists; pick a different snapshot name" >&2
  exit 1
fi
mkdir -p "$out_dir"

cd "$abs_folder"

# Tree: relative paths so two snapshots of the same folder line up.
# Filter out .DS_Store + AppleDouble files since those are macOS-side
# noise that change between sessions; the test plan deliberately
# excludes them when comparing parity.
find . -type f \
  ! -name '.DS_Store' \
  ! -name '._*' \
  | sort > "$out_dir/tree.txt"

# Hashes: sha256 per file, sorted by path. Same filter.
find . -type f \
  ! -name '.DS_Store' \
  ! -name '._*' \
  -print0 \
  | sort -z \
  | xargs -0 shasum -a 256 > "$out_dir/hashes.txt"

cat > "$out_dir/meta.txt" <<EOF
source: $abs_folder
snapshot: $name
captured: $(date -u +%Y-%m-%dT%H:%M:%SZ)
host: $(uname -srm)
EOF

file_count=$(wc -l < "$out_dir/tree.txt" | tr -d ' ')
echo "Snapshot saved to: $out_dir"
echo "  $file_count files"
echo "  tree.txt + hashes.txt + meta.txt"
