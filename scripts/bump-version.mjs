#!/usr/bin/env node
/**
 * Atomic version bumper for BandMate Studio.
 *
 * We carry the version in three files that the Tauri build pipeline
 * reads independently:
 *
 *   - src-tauri/tauri.conf.json   (the canonical source — what the
 *                                  bundler reads to populate Info.plist
 *                                  on macOS and version resources on
 *                                  Windows)
 *   - src-tauri/Cargo.toml        (the Rust crate version; surfaces in
 *                                  Cargo metadata and the binary)
 *   - package.json                (the Node side; informational, and
 *                                  what `pnpm` reports for the project)
 *
 * Letting any of these drift gives confusing builds and crash reports.
 * This script reads from `tauri.conf.json` (the canonical source),
 * computes the next version per semver bump level, and writes all
 * three files in lockstep.
 *
 * Usage (from package.json scripts):
 *
 *     pnpm bump:patch    →  0.2.1 → 0.2.2
 *     pnpm bump:minor    →  0.2.1 → 0.3.0
 *     pnpm bump:major    →  0.2.1 → 1.0.0
 *
 * Convention for BandMate Studio: see docs/VERSIONING.md. Short form:
 * bump PATCH for fix-only PRs, bump MINOR for any PR introducing new
 * behavior (the default — most PRs). MAJOR is reserved for 1.0 and
 * any future format/contract changes.
 *
 * After bumping, this script prints the new version. The PR author
 * is responsible for amending the bump into their commit and (for
 * release-level bumps) tagging `v<version>` after merge.
 *
 * Implementation note: edits are intentionally minimal — we only
 * touch the version line in each file. No JSON or TOML pretty-
 * printing so diffs stay clean.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const TAURI_CONF = resolve(repoRoot, "src-tauri/tauri.conf.json");
const CARGO_TOML = resolve(repoRoot, "src-tauri/Cargo.toml");
const PACKAGE_JSON = resolve(repoRoot, "package.json");

function readCurrentVersion() {
  const text = readFileSync(TAURI_CONF, "utf8");
  const match = text.match(/"version"\s*:\s*"([^"]+)"/);
  if (!match) {
    throw new Error(
      `Couldn't find a "version" field in ${TAURI_CONF}. ` +
        `Has the file structure changed?`,
    );
  }
  return match[1];
}

function bump(version, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    throw new Error(
      `Current version "${version}" doesn't look like MAJOR.MINOR.PATCH.`,
    );
  }
  const [major, minor, patch] = m.slice(1).map(Number);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump level "${level}". Use major / minor / patch.`);
  }
}

/**
 * Replace exactly one `version`-line occurrence in a file with the
 * new value. Throws if zero or more-than-one matches found — better
 * to fail loudly than to silently corrupt a multi-version file.
 */
function patchVersionLine(filePath, regex, replacement, label) {
  const before = readFileSync(filePath, "utf8");
  const matches = before.match(regex);
  if (!matches) {
    throw new Error(`${label}: didn't find a version line matching ${regex}.`);
  }
  // Convert /g flag presence into a count check.
  const all = before.match(new RegExp(regex.source, "g"));
  if (all && all.length > 1) {
    throw new Error(
      `${label}: found ${all.length} version-line matches; expected exactly one.`,
    );
  }
  const after = before.replace(regex, replacement);
  if (after === before) {
    // Replacement happened to be a no-op (already at target version).
    // Still rewrite so file mtime updates; harmless.
  }
  writeFileSync(filePath, after);
}

function patchAll(newVersion) {
  // tauri.conf.json — top-level `"version": "X.Y.Z",`
  patchVersionLine(
    TAURI_CONF,
    /"version"\s*:\s*"[^"]+"/,
    `"version": "${newVersion}"`,
    "tauri.conf.json",
  );

  // Cargo.toml — under [package], `version = "X.Y.Z"`. We anchor the
  // match to the line so a future [dependencies] crate version
  // doesn't get rewritten too.
  patchVersionLine(
    CARGO_TOML,
    /^version\s*=\s*"[^"]+"/m,
    `version = "${newVersion}"`,
    "Cargo.toml",
  );

  // package.json — top-level `"version": "X.Y.Z",`. There's exactly
  // one match in a well-formed package.json.
  patchVersionLine(
    PACKAGE_JSON,
    /"version"\s*:\s*"[^"]+"/,
    `"version": "${newVersion}"`,
    "package.json",
  );
}

// ---- main ----

const level = process.argv[2];
if (!level || !["major", "minor", "patch"].includes(level)) {
  console.error(
    "Usage: node scripts/bump-version.mjs <major|minor|patch>\n" +
      "       (typically invoked via `pnpm bump:patch` / bump:minor / bump:major)",
  );
  process.exit(1);
}

const current = readCurrentVersion();
const next = bump(current, level);
patchAll(next);
console.log(`Version bumped: ${current} → ${next}`);
console.log("Files updated:");
console.log("  src-tauri/tauri.conf.json");
console.log("  src-tauri/Cargo.toml");
console.log("  package.json");
console.log("");
console.log("Next steps:");
console.log("  1. Amend the version change into your PR commit:");
console.log("     git add -u && git commit --amend --no-edit");
console.log(`  2. (post-merge) tag the release: git tag v${next} && git push --tags`);
