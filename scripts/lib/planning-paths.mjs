/**
 * Shared allowlist of "planning-doc" paths that bypass the version-bump /
 * CHANGELOG-entry ceremony. See `BACKLOG.md` entry "Planning-docs fast lane"
 * for the rationale, and `docs/HYGIENE-PLAN.md` Phase H1 for where the
 * exception fits in CI.
 *
 * Two kinds of entries:
 *   - File entries: matched by EXACT string equality against a changed path.
 *   - Directory entries: written with a trailing slash. Matched as a path
 *     PREFIX — anything under that directory qualifies.
 *
 * The list is intentionally narrow. Reference docs that contributors (human
 * or Code) read for normative information (CLAUDE.md, README, SPEC, ROADMAP,
 * VERSIONING, etc.) stay on the ceremony track — see the backlog entry's
 * "Open Questions" for why.
 */
export const PLANNING_PATHS = [
  "BACKLOG.md",
  "docs/HYGIENE-PLAN.md",
  "docs/CLEANUP-PLAN.md",
  "docs/archive/",
];

/**
 * Returns true if EVERY path in `changedPaths` matches an entry in
 * `PLANNING_PATHS`. Matching rules:
 *
 *   - An allowlist entry ending in "/" (e.g. "docs/archive/") matches any
 *     changed path that starts with that prefix.
 *   - Any other allowlist entry (e.g. "BACKLOG.md") matches only an exact
 *     string equality.
 *
 * An empty `changedPaths` returns false — "no changes" is not "planning
 * only," and callers should not treat it as a skip signal.
 */
export function isPlanningOnlyDiff(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return false;
  return changedPaths.every((p) =>
    PLANNING_PATHS.some((entry) =>
      entry.endsWith("/") ? p.startsWith(entry) : p === entry,
    ),
  );
}

// Tiny CLI so shell scripts (scripts/update-planning.sh) can reuse the
// same allowlist without re-declaring it. Two modes:
//   node scripts/lib/planning-paths.mjs list
//       — prints each entry on its own line.
//   node scripts/lib/planning-paths.mjs check <path> [<path>...]
//       — exits 0 if every path matches; exits 1 and prints the offenders
//         otherwise (or exits 1 with no offenders if zero paths given).
import { fileURLToPath } from "node:url";
import { argv } from "node:process";

const invokedAsScript =
  argv[1] && fileURLToPath(import.meta.url) === argv[1];

if (invokedAsScript) {
  const [, , subcommand, ...paths] = argv;
  if (subcommand === "list") {
    for (const p of PLANNING_PATHS) console.log(p);
    process.exit(0);
  } else if (subcommand === "check") {
    if (paths.length === 0) {
      console.error("planning-paths check: no paths supplied");
      process.exit(1);
    }
    const offenders = paths.filter(
      (p) =>
        !PLANNING_PATHS.some((entry) =>
          entry.endsWith("/") ? p.startsWith(entry) : p === entry,
        ),
    );
    if (offenders.length === 0) process.exit(0);
    for (const o of offenders) console.log(o);
    process.exit(1);
  } else {
    console.error("Usage: planning-paths.mjs <list|check> [paths...]");
    process.exit(2);
  }
}
