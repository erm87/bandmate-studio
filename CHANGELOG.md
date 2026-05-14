# Changelog

All notable changes to BandMate Studio are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). For the project's specific phase criteria (alpha → beta → stable) and the bump workflow, see [docs/VERSIONING.md](docs/VERSIONING.md).

## [Unreleased]

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
