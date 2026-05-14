#!/usr/bin/env node
/**
 * Verifies CHANGELOG.md has a top-level `## [<version>] — YYYY-MM-DD`
 * section for the version currently in package.json, AND that the section
 * is a *sibling* of `## [Unreleased]` rather than content nested under it.
 *
 * Load-bearing test case — the PR #34 failure mode:
 *
 *     ## [Unreleased]
 *
 *     ### Added            ← entries placed under [Unreleased] is wrong
 *
 *     - <your change>
 *
 *     ## [0.8.7] — 2026-05-13
 *
 * That CHANGELOG shipped with package.json at 0.8.8 — there was no
 * `## [0.8.8] — …` heading at all. This script catches that case by
 * requiring (a) the body of `## [Unreleased]` be empty (only whitespace
 * between the heading and the next `## […]` heading), and (b) the very
 * next `## […]` heading match the current package.json version.
 *
 * See docs/VERSIONING.md step 4 + CLAUDE.md for the prescriptive
 * placement rule this enforces.
 *
 * Exits 0 on success; exits 1 with a clear message on any of:
 *   - CHANGELOG.md missing or unreadable
 *   - `## [Unreleased]` heading missing
 *   - `## [Unreleased]` has non-empty body (content placed under it)
 *   - No `## [<version>] — YYYY-MM-DD` heading for current version
 *   - Current-version heading exists but is malformed (no date, etc.)
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const PACKAGE_JSON = resolve(repoRoot, "package.json");
const CHANGELOG = resolve(repoRoot, "CHANGELOG.md");

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
const version = pkg.version;
if (!version) {
  console.error("check:changelog — package.json has no version field");
  process.exit(1);
}

let changelog;
try {
  changelog = readFileSync(CHANGELOG, "utf8");
} catch (err) {
  console.error("check:changelog — cannot read CHANGELOG.md: " + err.message);
  process.exit(1);
}

const lines = changelog.split(/\r?\n/);

// Index every h2 heading that starts with `## [` (Unreleased + each version).
const h2Indices = [];
for (let i = 0; i < lines.length; i++) {
  if (/^## \[/.test(lines[i])) h2Indices.push(i);
}

const unreleasedIdx = h2Indices.find((i) => /^## \[Unreleased\]\s*$/.test(lines[i]));
if (unreleasedIdx === undefined) {
  console.error("check:changelog — FAIL: `## [Unreleased]` heading not found in CHANGELOG.md");
  process.exit(1);
}

const nextH2Idx = h2Indices.find((i) => i > unreleasedIdx);
if (nextH2Idx === undefined) {
  console.error(
    "check:changelog — FAIL: no version section follows `## [Unreleased]` — " +
      "expected `## [" + version + "] — YYYY-MM-DD`",
  );
  process.exit(1);
}

// The body between [Unreleased] and the next h2 must be whitespace-only.
// This catches the PR #34 failure mode (### Added / bullet entries placed
// directly under [Unreleased] with no version heading for them).
const unreleasedBody = lines.slice(unreleasedIdx + 1, nextH2Idx);
const nonEmpty = unreleasedBody.filter((l) => l.trim().length > 0);
if (nonEmpty.length > 0) {
  console.error(
    "check:changelog — FAIL: content found under `## [Unreleased]`. " +
      "Entries must live in their own `## [<version>] — YYYY-MM-DD` section " +
      "as a sibling of `## [Unreleased]`, not nested under it. " +
      "See docs/VERSIONING.md step 4.",
  );
  console.error("Offending lines:");
  for (const l of nonEmpty.slice(0, 5)) console.error("  " + l);
  if (nonEmpty.length > 5) console.error("  … (" + (nonEmpty.length - 5) + " more)");
  process.exit(1);
}

// The first version heading after [Unreleased] must match the current version,
// in the form `## [X.Y.Z] — YYYY-MM-DD` (em dash, not hyphen).
const nextH2Line = lines[nextH2Idx];
const expectedHeading = new RegExp(
  "^## \\[" + version.replace(/\./g, "\\.") + "\\] — \\d{4}-\\d{2}-\\d{2}\\s*$",
);
if (!expectedHeading.test(nextH2Line)) {
  console.error(
    "check:changelog — FAIL: expected the section after [Unreleased] to be " +
      "`## [" + version + "] — YYYY-MM-DD`, found:",
  );
  console.error("  " + nextH2Line);
  console.error("");
  console.error(
    "Either the current version has no CHANGELOG entry yet, or the heading " +
      "uses the wrong format (em dash `—` required, date required as YYYY-MM-DD).",
  );
  process.exit(1);
}

console.log("check:changelog — OK (found `" + nextH2Line.trim() + "`)");
process.exit(0);
