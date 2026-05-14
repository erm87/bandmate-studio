#!/usr/bin/env node
/**
 * Verifies the four version files agree.
 *
 * The bump script (scripts/bump-version.mjs) writes all four in lockstep,
 * but nothing prevents a hand-edit or a botched merge from leaving them
 * out of sync. CI runs this on every PR so a drift can't ship.
 *
 * Exits 0 if all four show the same version string; exits 1 with each
 * file's actual version printed if any disagree.
 *
 * Files (kept identical to bump-version.mjs's set):
 *   - src-tauri/tauri.conf.json   (canonical — top-level "version")
 *   - src-tauri/Cargo.toml        ([package] version line)
 *   - src-tauri/Cargo.lock        (the bandmate-studio [[package]] entry,
 *                                  NOT other crates in the lockfile)
 *   - package.json                (top-level "version")
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const FILES = {
  "src-tauri/tauri.conf.json": (text) => {
    const m = text.match(/"version"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  },
  "src-tauri/Cargo.toml": (text) => {
    const m = text.match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  },
  "src-tauri/Cargo.lock": (text) => {
    // Anchor on the bandmate-studio package block specifically — Cargo.lock
    // has hundreds of [[package]] entries and many share version strings.
    const m = text.match(/name = "bandmate-studio"\nversion = "([^"]+)"/);
    return m ? m[1] : null;
  },
  "package.json": (text) => {
    const m = text.match(/"version"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  },
};

const results = {};
let anyMissing = false;
for (const [relPath, extract] of Object.entries(FILES)) {
  const absPath = resolve(repoRoot, relPath);
  let text;
  try {
    text = readFileSync(absPath, "utf8");
  } catch (err) {
    console.error("check:versions — cannot read " + relPath + ": " + err.message);
    anyMissing = true;
    continue;
  }
  const version = extract(text);
  if (!version) {
    console.error("check:versions — could not find a version string in " + relPath);
    anyMissing = true;
    continue;
  }
  results[relPath] = version;
}

if (anyMissing) process.exit(1);

const versions = new Set(Object.values(results));
if (versions.size === 1) {
  console.log("check:versions — OK (all four at " + [...versions][0] + ")");
  process.exit(0);
}

console.error("check:versions — FAIL: version-file mismatch");
for (const [relPath, version] of Object.entries(results)) {
  console.error("  " + relPath.padEnd(28) + " " + version);
}
console.error("");
console.error("Run `pnpm bump:patch|minor|major` to re-sync, or fix by hand.");
process.exit(1);
