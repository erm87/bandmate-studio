# Changelog

All notable changes to BandMate Studio are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). For the project's specific phase criteria (alpha → beta → stable) and the bump workflow, see [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

## [0.9.2] — 2026-05-15

### Documentation

- **BACKLOG** — captured *USB Export — progress indicator with ETA, cancel, success/error/canceled states*: a full state-machine design (pre-flight → in-progress → success/error/canceled), Rust↔JS progress event channel, cooperative cancellation policy options, and a phased shipping plan, motivated by the current export dialog giving zero feedback during a multi-GB write.

## [0.9.1] — 2026-05-14

### Documentation

- **BACKLOG** — two new entries captured at the top of the file:
  - *Sidebar — keyboard arrow navigation when no editor sub-selection is active.* ↑/↓ walks the current sidebar section (songs / playlists / track maps) when no channel or playlist-row sub-selection is consuming arrows. Gating mirrors the existing ESC chain; navigation routes through `requestSelect` so the unsaved-changes guard still applies. No wrap at section boundaries.
  - *Song editor — stopwatch icon on all rows tied for longest duration.* Replaces the current `longestFilename: string | null` single-row marker with a set so every file whose sample count matches the song's max gets the stopwatch. Comparison is in samples (integer), not seconds, to avoid `m:ss`-rounding false ties. Per-row change-dot precedence (from 0.7.1) is unchanged.

### Notes

- Docs-only PR — no behavior change. Patch bump per the project's per-PR bump workflow (no new mechanism, no UI change; just backlog capture).

## [0.9.0] — 2026-05-14

### Added

- **CI minimum viable — Phase H1 of [docs/HYGIENE-PLAN.md](docs/HYGIENE-PLAN.md).** New GitHub Actions workflow at [`.github/workflows/ci.yml`](.github/workflows/ci.yml) gates every PR against `main` on five checks, plus two new local scripts surfacing the same checks on demand.
  - `pnpm typecheck` — `tsc --noEmit`.
  - `pnpm test` — the 42-test vitest codec round-trip suite.
  - `pnpm check:versions` — new script at [`scripts/check-version-sync.mjs`](scripts/check-version-sync.mjs); verifies `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `bandmate-studio` entry in `src-tauri/Cargo.lock` all show the same version string. Exits non-zero with each file's actual version on mismatch.
  - `pnpm check:changelog` — new script at [`scripts/check-changelog-entry.mjs`](scripts/check-changelog-entry.mjs); verifies CHANGELOG.md has a `## [<version>] — YYYY-MM-DD` section for the current `package.json` version, and that the section is a sibling of `## [Unreleased]` rather than content nested under it. Catches the PR #34 failure mode (entries dumped under `## [Unreleased]` with no version heading) — documented as a load-bearing test case in the script header.
  - `cargo check --locked` — fastest Rust-side smoke that the workspace still compiles.

### Notes

- Bumped MINOR rather than PATCH (recent precedent for non-user-visible PRs has been PATCH): this adds a new project-level mechanism — CI gating + two new scripts — not just docs. Deliberate call against recent cadence; see PR description.
- **Acceptance test deferred to a follow-up.** Phase H1's acceptance criterion ("deliberately break a version file, verify CI fails") requires a second PR after this one lands and the workflow has run at least once on `main`. Captured in the PR description; not gated by this PR.
- **GitHub branch protection not configured by this PR.** Setting "Require status checks to pass before merging" → `ci` requires admin-level access in the GitHub UI; Eric will configure it after the workflow runs successfully at least once.
- CI runs on `ubuntu-latest` with the standard Tauri 2.x Linux system deps (`libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`, etc.). If those deps misbehave on the first run, the fix is workflow-side (swap to `macos-latest` or adjust deps), not code-side.

## [0.8.10] — 2026-05-14

### Documentation

- **CHANGELOG cleanup + workflow-doc clarification (the workflow violation flagged in [0.8.9]'s Notes).** Two changes:
  - **`CHANGELOG.md`** — moved the four `### Added` / `### Changed` / `### Notes` entries that PR #34 placed under `## [Unreleased]` into a proper `## [0.8.8] — 2026-05-14` section. Original content preserved verbatim; a Notes bullet inside `[0.8.8]` records the relocation. Also dropped the now-resolved "Version collision" bullet from `[0.8.9]`'s Notes.
  - **`docs/VERSIONING.md` + `CLAUDE.md`** — clarified step 4 of the per-PR bump workflow. The previous phrasing ("add a new section under `## [Unreleased]`") was ambiguous and bit PR #34: it can be read as either "as its next sibling" (the project convention, used by every entry from 0.7.0 through 0.8.9) or "as content nested under that heading" (PR #34's reading). Replaced with explicit prescriptive wording ("**directly below** the `## [Unreleased]` heading, as its next sibling, *not* as content nested under it — `[Unreleased]` stays an empty placeholder") plus a concrete before/after example in `docs/VERSIONING.md` showing the right and wrong layouts side-by-side.

### Notes

- Docs-only PR — no behavior change, no codec changes, no UI changes. Typecheck and the 42-test vitest suite both pass. Patch-bump because the change is fix-only (CHANGELOG re-layout + doc-wording fix; no new feature).
- v0.8.9 was tagged on `main` at the merge commit before this fix-up branched, so the tag points at history-as-released; this PR doesn't rewrite the 0.8.9 release.

## [0.8.9] — 2026-05-14

### Documentation

- **New `docs/HYGIENE-PLAN.md` — companion to [docs/CLEANUP-PLAN.md](docs/CLEANUP-PLAN.md).** CLEANUP-PLAN.md is the one-shot phased list to bring the repo to a sharable baseline; HYGIENE-PLAN.md is the ongoing reference for *staying* clean from here on. Organized as a **four-layer mechanism model** — Layer 1 *CI on every PR* (typecheck, vitest, `cargo check`, new `check-version-sync` / `check-changelog-entry` scripts, codec round-trip rule); Layer 2 *cloud-scheduled Routines* (weekly dep-update sweep, weekly backlog freshness, monthly doc-drift, monthly dead-code scan, quarterly codec-fixture-refresh reminder — all output as draft PRs / issues, never auto-merge); Layer 3 *optional pre-commit hooks* via husky (catches the same things as CI but earlier in the loop); Layer 4 *process & habits* with explicit trigger subsections (per-PR diff-review discipline beyond the gates, per phase-flip checklist with concrete-artifact walkthrough + personal gates from CLAUDE.md + compat + smoke reruns, user-visible-feature → README/SMOKE-TEST/CLAUDE.md alignment, BM Loader new-release → re-decompile/compat-rerun/fixture-refresh/pinned-CHANGELOG-note, before-rehearsal working-USB walkthrough, "investigate before gitignoring" rule, quarterly architectural review). Followed by a **phased rollout** H1–H6 ordered cheapest-highest-leverage with acceptance criteria per phase (H1 CI minimum viable → H2 first Routine → H3 backlog+doc Routines → H4 dead-code Routine → H5 optional pre-commit hooks → H6 pre-Beta release-readiness Routine). Closes with a **Routines fit analysis** explaining why CI is the right tool for Layer 1 rather than Routines (rate limits would constrain merge throughput — Pro 5/day, Max 15/day would cap PR gating), a **maintaining-this-plan meta-section** with the four triggers for re-reading the doc, and a **what-this-doesn't-cover** boundary section pointing to BACKLOG/ROADMAP/CLEANUP-PLAN/SPEC/CLAUDE.md.

### Notes

- Docs-only PR — no behavior change, no codec changes, no UI changes. Typecheck and the 42-test vitest suite both pass. Not a cleanup-plan phase — sits alongside CLEANUP-PLAN.md as a separate, ongoing reference. Phases H1–H6 are proposals, not committed-to work; the doc itself ships in this PR but each rollout phase is a separate future PR.

## [0.8.8] — 2026-05-14

### Added

- **`docs/EXPORT-PARITY-TEST.md`** — manual audit procedure for verifying USB-export byte-parity vs. BM Loader on macOS and Windows. Mirrors [`docs/COMPAT-TEST.md`](docs/COMPAT-TEST.md)'s structure: preconditions, Phases A–E (baseline → BMS export → diff → source-stability check → hardware playback lite), known acceptable diffs, reporting format. Closes the documentation gap for [Beta criterion 2](docs/ROADMAP.md#criteria) and parallels how `COMPAT-TEST.md` closes criterion #1.

### Changed

- **`docs/ROADMAP.md`** — criterion #2 line now links to the new audit doc and records the macOS PASS (2026-05-14) and Windows-pending status inline.
- **`CLAUDE.md`** — reliability principle's "USB export pipeline" sentence now points at both `COMPAT-TEST.md` (working-folder parity) and the new `EXPORT-PARITY-TEST.md` (USB-export parity).
- **`README.md`** — docs index entry for `COMPAT-TEST.md` re-labeled with its Beta-criterion-1 scope; new entry added for `EXPORT-PARITY-TEST.md` with its Beta-criterion-2 scope.
- **`.gitignore`** — added `audit-runs/` so parity-test scratch outputs (timestamped snapshot folders generated during EXPORT-PARITY-TEST runs) never accidentally get committed.

### Notes

- **macOS half of [Beta criterion 2](docs/ROADMAP.md#criteria) passed (2026-05-14).** Ran the new audit's pretend-USB short form against a representative working folder (14 song folders, 2 playlists, 1 custom track map). BMS export tree is byte-identical to source modulo the documented `.bandmate-studio.json` sidecar strip — 48 source files → 44 dest files, 4 sidecars removed, zero content drift. The full BM-Loader-driven audit was not run this session; the short form treats the working folder as the BM-Loader baseline (correct under [SPEC.md](SPEC.md)'s "working folder is what gets pushed to the USB" model) and is sufficient to validate that BMS isn't introducing drift relative to its source. Windows half is blocked on [criterion #4](docs/ROADMAP.md#criteria) ("Windows build validated").
- Docs-only PR — no behavior change, no codec changes, no UI changes. Typecheck and the 42-test vitest suite both pass.
- Entries originally landed under `## [Unreleased]` in PR #34 (a workflow ambiguity in the bump docs at the time — see PR #36 / `[0.8.10]` for the convention clarification). Relocated to this `## [0.8.8]` section to match the project convention; original content preserved verbatim.

## [0.8.7] — 2026-05-14

### Changed

- **`src/` audit — Phase 6 of [docs/CLEANUP-PLAN.md](docs/CLEANUP-PLAN.md).** Dead-code + duplicate-helper sweep. Baseline was already healthy: `tsc --noUnusedLocals --noUnusedParameters` passes with no output, no unused exports across `lib/` / `codec/` / `state/` / `fs/` / `components/`, file naming is consistent (PascalCase `.tsx` components, camelCase `.ts` utilities). Three concrete changes:
  - **Deleted `src/components/MainPlaceholder.tsx`.** Its file body explicitly read "intentionally left empty so a future cleanup pass can delete it from disk" — renamed to `WelcomeStub.tsx` back in PR #1; the tombstone has been sitting unused since. Also cleaned up a now-stale "renamed for clarity" comment in `WelcomeStub.tsx` that referenced the deleted file.
  - **Lifted `formatDuration` into `src/lib/duration.ts`** (this lift was explicitly named in the cleanup plan). Two implementations existed: `PlaylistHeader.tsx` (richer, handles `h:mm:ss` for durations ≥1 hour) and `ChannelGrid.tsx` (simpler `m:ss` only). Promoted the richer version; output is identical to the old `m:ss`-only for any realistic per-channel duration and future-proofs the channel case at zero cost.
  - **Lifted byte formatting into `src/lib/bytes.ts`.** Four near-identical formatters existed: `ExportToUsbDialog.formatBytes` (B/KB/MB/GB), `CleanupConfirmDialog.formatBytes` (same + null→""), `ImportTrackMapDialog.formatSize` (B/KB/MB only, no GB tier), and an exported `exportFilter.formatExportBytes` (same as the Export dialog's local one). Unified into one `formatBytes(bytes: number | null): string` that handles null → "" and all four tiers. The `formatExportBytes` export is dropped from `lib/exportFilter.ts` (was only imported by `ExportToUsbDialog`, which now uses `lib/bytes` directly).

### Notes

- Net: 67 insertions, 69 deletions across 10 files. Two new `lib/` modules, six components / libs updated to import from them, one tombstone deleted, one stale comment cleaned up. No behavior change — every call site receives the same string output it did before (verified via diff and the 42-test vitest suite, which still passes).
- Deliberately skipped per the cleanup plan's "don't be too aggressive" framing: `validateName` × 4 (in the `New*Dialog`s and `RenameDialog` — common core is only 5 lines, each function has dialog-specific collision logic that makes them intentionally distinct), and `formatModified` × 2 (`ImportTrackMapDialog` vs `SourceFilesPane` use intentionally different output formats — date-only vs date+time with a `modified ` prefix and different null-return conventions). Neither is a true duplicate.

## [0.8.6] — 2026-05-14

### Documentation

- **`docs/` refresh — Phase 5 of [docs/CLEANUP-PLAN.md](docs/CLEANUP-PLAN.md).** Four files updated; `COMPAT-TEST.md` and `ROADMAP.md` were checked for drift and left as-is.
  - **`docs/CODEC-PARITY-AUDIT.md`** — prepended a status banner annotating the doc as historical: the one-shot 2026-04-28 audit confirmed BMS's codec against the decompiled BM Loader source; finding #1 (`<trackmap>` optionality) was the only real divergence and was fixed; findings #2–#8 are informational with no action required. Ongoing BM Loader parity is now verified via the round-trip protocol in [docs/COMPAT-TEST.md](docs/COMPAT-TEST.md), which closed Beta criterion 1 on 2026-05-14.
  - **`docs/DEV-SETUP.md`** — fixed three small drift items: the "First run" code block no longer hardcodes Eric's local absolute path (`/Users/ericmorgan/.../Band Live Rig/improvements/bm-loader-rebuild`); the `pnpm test` comment says "(codec round-trip tests)" instead of "(Phase 1)"; the "Code-signing + notarization is on the v0.2 list" line was reframed to point at [docs/ROADMAP.md § v1.x Distribution](docs/ROADMAP.md#distribution-1) where the signing decision actually gets made. Also added a `pnpm bump:*` row to the Common dev commands block with a pointer to [docs/VERSIONING.md](docs/VERSIONING.md).
  - **`docs/SMOKE-TEST.md`** — added five new check groups for features shipped between v0.4 and v0.8: §1e Smart Mapping settings toggle; §1f USB export skip-unreferenced settings toggle; §2b-1 per-row change indicators; §2c Source Folder Refresh button; §2c-1 Smart Import confirmation dialog; §7b filter for `.bandmate-studio.json` + `.DS_Store` on export; §7c skip-unreferenced behavior at export time.
  - **`docs/VERSIONING.md`** — corrected §Workflow step 2 from "all three version files" to "all four version files"; added `src-tauri/Cargo.lock` to the listed files (the bump script touches all four and has done since 0.6.x, but the doc lagged).

### Notes

- Docs-only PR — no behavior change, no codec changes, no UI changes. Typecheck and the 42-test vitest suite both pass.

## [0.8.5] — 2026-05-14

### Documentation

- **README rewritten for v0.8.x reality** (Phase 2 of [docs/CLEANUP-PLAN.md](docs/CLEANUP-PLAN.md)). The prior README claimed "Pre-MVP scaffold; UI implementation has not started" — dramatically wrong at v0.8.4 with the working-folder backwards-compat audit closed and most of the original MVP plan shipped. New version captures: current Alpha status with Beta criteria progress (1 of 6 closed, 5 remaining), a one-paragraph value prop + an eight-bullet feature list covering what BMS does beyond BM Loader (Smart Mapping, per-row change indicators, MIDI cleaning via `midly`, sticky export destination, automatic `dot_clean -m` on macOS exports, sample-rate mismatch warnings, keyboard ergonomics with unsaved-changes guard, light/dark/auto color modes), a public-clone-correct Quickstart (drops the `cd improvements/bm-loader-rebuild` prefix that assumed Eric's local monorepo layout), an updated Tech stack row for `midly` and a corrected Windows-distribution note ("Beta criterion (in progress)" vs the old "deferred to v0.2"), a condensed "Why a rewrite (not a fork)" framing of the BM Loader decompilation context with the clean-room discipline note, a new Documentation section indexing the ten key docs (CLAUDE, SPEC, ROADMAP, VERSIONING, COMPAT-TEST, SMOKE-TEST, DEV-SETUP, BACKLOG, CHANGELOG, CLEANUP-PLAN, archive/), and a softened License placeholder pointing at the external-readiness pass (Phase 8). Stale Project-layout tree dropped — Documentation section serves the navigational purpose better and won't drift.

### Notes

- Docs-only PR — no behavior change, no codec changes, no UI changes. Typecheck and the 42-test vitest suite both pass. Removed the broken relative-path link to `../bandmate-custom-build/` (the sibling-directory hint only resolved in Eric's local workspace, not for anyone cloning the public GitHub repo); the project-family mention is preserved as prose without the link.

## [0.8.4] — 2026-05-14

### Changed

- **Repo cleanup — batch 1 (three lowest-risk phases from `docs/CLEANUP-PLAN.md`).**
  - **Phase 1 (cruft + .gitignore):** removed the tracked 0-byte `_tmp_3_3c7399f521744105a15156eb3385480a` scaffolding leftover; added a Windows block (`Thumbs.db`, `Desktop.ini`) to `.gitignore` preemptively since Beta criterion 4 in [docs/ROADMAP.md](docs/ROADMAP.md) targets a Windows build; broadened the TS-incremental-build-cache rule from `tsconfig.tsbuildinfo` to `*.tsbuildinfo`. `tsconfig.tsbuildinfo` was already gitignored and never tracked in history.
  - **Phase 3 (archive MVP-PLAN.md):** moved the original phased v0.1 plan (`MVP-PLAN.md`, written 2026-05-11) to `docs/archive/MVP-PLAN-2026-05-11.md` with a short archival-note header pointing to current planning ([docs/ROADMAP.md](docs/ROADMAP.md) + [BACKLOG.md](BACKLOG.md)). Most of the original plan has shipped or been refactored; release-level goals now live in ROADMAP and active polish items in BACKLOG. Reference updates: README's "phased v0.1 checklist" link repointed at the archive (with a note that current planning is in ROADMAP); dropped the bare `— see MVP-PLAN.md` fragment from a SPEC.md bullet. Git tracks the move as a rename so the file's history follows it. The README's broader staleness (still claims "Pre-MVP scaffold") is Phase 2 of the cleanup plan and intentionally not touched here.
  - **Phase 7 (audit logos/):** moved the original scaffolding-era app icon set `logos/bandmate-app-icon/` (9 files) to `logos/archive/bandmate-app-icon/` — superseded by the `bandmate-studio-icon/concept-B-wave.svg` flow in PR #13. Added a new `logos/README.md` documenting the directory structure, which files are the current BMS app icon source, which top-level PNGs are byte-identical to `src/assets/` production copies (with a sync note), and what `vectors/` / `highres/` are for. `bandmate-studio-icon/`, `joeco-logo-*-retina-flat*.png`, `vectors/`, and `highres/` all kept in place as active sources / brand library / vector source-of-truth.

### Notes

- Docs/hygiene-only PR — no behavior change, no codec changes, no UI changes. Typecheck and the 42-test vitest suite both pass at each phase. Cleanup phases 2, 4, 5, 6, 8 from `docs/CLEANUP-PLAN.md` are deferred to follow-up PRs.

## [0.8.3] — 2026-05-14

### Documentation

- `CLAUDE.md`: added a **Design conventions** section capturing four recurring decisions that aren't enforced by tooling and aren't obvious from any single file: the "allow with a visible warning" stance vs BM Loader's hard-blocks (sample-rate change after assignment; LVL/PAN editing once we build it), the distinction between public ROADMAP criteria and personal release gates (rehearsal validation + Joe Q&A), the click-to-assign (not drag-drop) channel-assignment model that the Smart Import dialog and on-row actions are built on, and the read-only treatment of the user's source folder (BMS writes only to the song folder; orphan cleanup is opt-in via the explicit affordance). Surfaces context that previously lived only in conversation memory.

## [0.8.2] — 2026-05-14

### Documentation

- **Added `CLAUDE.md` at the repo root** — onboarding guide for Claude Code sessions in this repo. Covers the common dev commands (`pnpm tauri dev/build`, `pnpm test`, `pnpm typecheck`, `pnpm bump:*`), the JS/Rust architecture split (FS I/O in Rust to bypass Tauri's scope-gating; codec pure-TS so it tests in Node), the codec invariants from `SPEC.md` (CRLF on `.jcm`, canonical write order on `.jcs`, lenient-read/strict-write), the AppState reducer + ESC chain + unsaved-changes guard, the Working Folder concept, and pointers to BM Loader byte-parity as a Beta criterion. Calls out the reliability principle (live-rig stability bias), the phase model with pointers to ROADMAP criteria, the per-PR version-bump workflow, and the gitignored `decompiled/` `pycdc` recovery as a clean-room reading reference.

## [0.8.1] — 2026-05-14

### Documentation

- **Working-folder backwards-compat audit complete.** Ran the full 5-phase protocol in `docs/COMPAT-TEST.md` against a substantive 4-song / 2-playlist / 4-track-map working folder, exercising both BMS and BM Loader as writers in alternating iterations. All phases PASS: BMS reads BM Loader's files without error, writes back without drift, and coexists cleanly across repeated round-trips. The `.jcs` writer is byte-perfect against BM Loader's output; the `.jcm` writer's F-3 CRLF→LF normalization fires as documented when a CRLF-seeded template is first saved by BMS. Closes Beta criterion 1 in [docs/ROADMAP.md](docs/ROADMAP.md).

### Changed

- `BACKLOG.md` pruned: removed the now-satisfied `[Beta blocker]` working-folder backwards-compat audit entry. The "Song editor — edit channel level, pan, mute" entry was also removed after confirming BM Loader doesn't support this either (it's a scope decision, not a parity gap — revisit only if user demand surfaces).

### Notes

- Two BM Loader behaviors documented during the audit but not flagged as regressions: (a) BM Loader's `.jcs` writer is not byte-stable (saving identical content twice produces different bytes — BMS's writer is the more stable reference); (b) BM Loader doesn't clean orphan stems when a channel is reassigned (BMS's "Clean up unreferenced files" affordance addresses this on the BMS side).

## [0.8.0] — 2026-05-13

### Added

- **Smart Mapping now proposes replacements for already-assigned channels** instead of silently skipping them. When Import all finds a fuzzy match for a channel that already has a file, the new **Smart Import** dialog lists each proposed replacement (`current → proposed`, plus the channel label) with a checkbox per row. All checkboxes default to checked; **Select all** / **Deselect all** at the top for bulk action. Footer: **Cancel**, **Import without auto-mapping** (copies every candidate into the song folder with no assignment changes — one-time override that doesn't touch the Smart Mapping preference), and **Replace N files** (applies the checked replacements + the empty-channel auto-fills). MIDI replacements participate in the same dialog. Unchecked replacements still copy into the song folder unassigned so the file's available for click-assign.
- Replacements that fire go through `applyEdit`, so they show in **Undo history**, flip the **dirty Save banner**, and surface in the **per-row change-dot indicator** shipped in 0.7.x. Replacing a channel preserves the prior **level / pan / mute** values so hand-tuned mixer settings survive a swap — only the filename changes.

### Notes

- Dialog only opens when at least one replacement is being proposed. Pure empty-channel imports (the common first-import case) still run friction-free with no dialog interruption — preserves the original Import all behavior for songs that haven't been imported before.
- The dialog is gated on `userPrefs.smartMappingEnabled`. With Smart Mapping off, every Import all file copies into the song folder unassigned — no fuzzy matching, no dialog. The Settings toggle remains the way to opt out permanently; the "Import without auto-mapping" button is the one-time override.

## [0.7.1] — 2026-05-13

### Changed

- **Per-row change indicator now outranks the longest-file stopwatch in the icon slot.** Previously the stopwatch on the longest-media row stayed visible even when that row's assignment had been edited since last save — the change dot was suppressed. Flipped the precedence so unsaved changes win: dirty state is transient and actionable (the user can only act on it until they Save), while the longest indicator is durable info that returns once Save clears the dot. The rate-mismatch warning still wins the slot over both (it's the only hard error).

## [0.7.0] — 2026-05-13

### Added

- **Song editor — per-row change indicators.** Channels whose file assignment differs from the last saved state now show a small brand-blue dot in the row's icon slot, with a hover tooltip describing the change (`Ch 3 — changed: drum_v1.wav → drum_v2.wav`, `Ch 5 — newly assigned: …`, `Ch 8 — removed: …`). Both audio rows and the MIDI row participate. Dots clear on Save (baseline resets) and are restored on Undo. Scope is file assignment only — per-channel Lvl / Pan / Mute tweaks are intentionally not surfaced so the indicator stays a clean at-a-glance "what did I touch" cue.

### Notes

- Priority in the row's 16px icon slot is *rate-mismatch warning > longest stopwatch > change dot*. If a row already has a warning or stopwatch, the change dot doesn't render — the dirty banner at the editor footer still carries the overall unsaved signal, and the more operational warning / longest signals stay visible.

## [0.6.0] — 2026-05-13

### Fixed

- **Import all** now copies all imported files (smart-matched + MIDI winner + direct-copy / overflow) into the song folder immediately. Previously matched files were queued in `pendingCopies` and didn't physically land in the song folder until the next Save, while unmatched files copied eagerly — creating an asymmetry where the Song Folder pane showed only a subset of the imports until Save. The toast's claim that files were "imported into the song folder" is now literally true at click-time, no Save round-trip required.

### Changed

- Import all's toast now counts *successful* copies rather than just queued imports. If any per-file copy fails mid-batch, the toast appends `"N failed to copy (see console)"` so the user has a signal to investigate.

### Notes

- The single-file click-to-assign flow is unchanged — clicking a single file in the Source Folder pane still assigns the channel immediately and queues the copy via `pendingCopies` for the next Save. Only the Import all batch op flipped to eager-copy.


## [0.4.0] — 2026-05-13

### Added

- Source Folder tab now has a **Refresh** button alongside Import all / Clear / Change…. Re-lists the current source folder so newly-added files (e.g., a fresh Logic bounce dropped into the folder mid-session) show up without round-tripping through Clear → Change → re-pick. Always enabled; the Import-all button's disabled state automatically recomputes after the refresh via the existing `onFilesLoaded` callback.


## [0.3.1] — 2026-05-13

### Documentation

- New `docs/COMPAT-TEST.md`: 5-phase round-trip test plan verifying BandMate Studio reads, writes, and coexists with BM Loader on the same working folder. Closes Beta criterion 1's *protocol* (test apparatus); the audit *run* is the remaining manual step.
- New `scripts/snapshot-working-folder.sh` + `scripts/diff-snapshots.sh`: small shell tools used by the compat protocol to capture tree + sha256 hashes of a working folder and surface added / removed / changed files between two snapshots.
- `BACKLOG.md`: updated the working-folder backwards-compat entry to reflect that the test plan + tooling are shipped; the audit run on a real working folder + BM Loader is the remaining Beta-blocker step.

### Changed

- `scripts/bump-version.mjs` now also patches `src-tauri/Cargo.lock` alongside the other three version files. Fixes a one-version drift that's existed since 0.2.0 (Cargo.lock was updated lazily by `cargo build` on the next dev cycle, which meant `git diff` always showed Cargo.lock churn after a bump). The lockfile is now in sync within the same commit as Cargo.toml.


## [0.3.0] — 2026-05-13

### Added

- Settings → About now has a **Send feedback…** button that opens a pre-filled GitHub Issues URL in your default browser. The body includes a feedback template (What happened / What did you expect / Steps to reproduce) plus the app's version and phase auto-captured in a collapsible "App context" block. User submits with their own GitHub account; no service-side secrets in the app.

### Notes

- Closes Beta criterion 5 (in-app feedback path). One Beta blocker remaining: working-folder backwards-compat audit.


## [0.2.1] — 2026-05-13

### Documentation
- New `docs/ROADMAP.md` as the canonical release roadmap (Beta / v1 / v2 criteria + v2 strategic-direction question).
- `docs/VERSIONING.md` slimmed to focus on bump mechanics + phase semantics; release criteria now live in `ROADMAP.md`.
- `BACKLOG.md` cleaned of stale entries (button cleanup, USB-export skip, editor-pane refactor); added 2 `[Beta blocker]` entries (in-app feedback, working-folder backwards-compat audit). Beta-blocker tagging added so we can see what gates the alpha → beta flip at a glance.

## [0.2.0] — 2026-05-13

Baseline release capturing all work to date. The on-disk version had been frozen at `0.1.0` since project start, so this version cuts a clean line under "everything shipped so far" and starts the bump-per-PR cadence. Phase: **alpha**.

### Added

#### Foundations
- Working folder picker + scan of `bm_media/bm_sources/` and `bm_media/bm_trackmaps/`.
- Three-pane editor: Sidebar (songs / playlists / track maps), editor pane (song / playlist / track-map editors), right-side source-files pane.
- `.jcs`, `.jcp`, `.jcm` codecs with read + write round-trip parity against BM Loader output (smoke-test audited).
- Tauri 2 backend (Rust) for filesystem operations (folder scan, WAV-header probe, MIDI parse + clean, recursive copy, USB export).

#### Song editing
- 24-channel + MIDI grid with per-channel level / pan / mute, file assignment, drag-drop reordering.
- Click-to-assign source files from the right-side pane.
- Cmd+Arrow swap adjacent channels; plain Arrow Up/Down navigates row selection.
- Delete / Backspace clears the selected channel.
- Save / Save As with pending-file copy on commit.
- Undo / Redo + undo history panel.
- `<length>` written as longest media duration across WAV + MIDI.
- Source folder per song (persisted in `.bandmate-studio.json` sidecar) for unimported file browsing.
- Import-all from Source Folder with fuzzy filename-to-channel matching (token-based scoring with camelCase / kebab-case / letter-digit boundaries; most-recent-mtime tiebreaker; non-destructive on occupied channels).
- Per-song "Clean up unreferenced files" — deletes `.wav` / `.mid` files in the song folder that aren't referenced by the `.jcs`.

#### Playlist editing
- Drag-drop song reordering; trackmap selection per playlist; cross-reference cleanup on song rename / delete.

#### Track-map editing
- 24-channel + MIDI label editor with empty / default / stems / modern-playback templates.
- Import a track map from another working folder via menu → folder picker → multi-select + collision resolver (Rename / Overwrite / Skip).
- Unlabeled channels render blank in the song editor (channel number stays for reference).

#### Settings
- Appearance: Light / Dark / Auto color mode.
- Defaults: default sample rate, default track map for new songs, default USB export destination.
- MIDI: auto-clean on import + retroactive clean offer.
- Export: "Only export referenced files" toggle, surfaced in the export confirm step with skipped-file count.

#### USB Export
- Native folder picker → confirm → progress-bar copy with per-file events → `dot_clean -m` on macOS to strip AppleDouble files → optional eject.
- Pre-export validation: surfaces playlist-references-missing-song warnings + per-song zero-media warnings when the "only referenced" toggle is on.
- Session memory of last destination; sticky default destination from Settings.
- Filters `.DS_Store`, `._*`, and `.bandmate-studio.json` sidecars on copy.

#### MIDI cleaning
- Strips non-essential meta events (markers, time/key signatures, track names, etc.) while preserving program changes, control changes, notes, set_tempo, end_of_track, sysex.
- Auto-clean on import (opt-in); manual per-file clean via the "Not clean" badge; retroactive batch clean from Settings.

#### Sidebar
- Sections for Songs / Playlists / Track Maps with seeded template grouping + "Template" badges.
- Rename / Duplicate / Delete via context menu with cross-reference impact preview.
- Tonal `+` chip to emphasize add-new affordance.

#### Other
- App icon (neon-cyan sine wave on deep-navy squircle) — see `logos/bandmate-studio-icon/`.
- View Transitions on editor-pane selection change to smooth content swaps.
- Shared `<Button>` component with `primary | tonal | tertiary | danger | ghost` variants and `xs | sm | md` sizes; press-feedback via `active:` states.
- Bottom-right `<Toast>` for non-blocking notifications (used by Import-all).

### Notes

- Versioning workflow documented in [docs/VERSIONING.md](docs/VERSIONING.md). Every PR going forward bumps via `pnpm bump:{patch,minor,major}`.
- All `0.1.0`-era work folded into this entry; individual feature changelogs prior to 0.2.0 live only in the git history.
