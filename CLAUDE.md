# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BandMate Studio (BMS) — a Tauri (Rust) + React + TypeScript + Tailwind desktop app that replaces JoeCo's **BM Loader**. It reads/writes the BandMate hardware's on-disk formats (`.jcm` track maps, `.jcs` songs, `.jcp` playlists, plus the `bm_media/` USB layout) so a Studio-produced USB stick is a drop-in for one produced by stock BM Loader.

**BM Loader is the predecessor app being replaced.** JoeCo's stock BM Loader is a Python 3.12 + PySimpleGUI v2 desktop app whose source isn't public. A `pycdc` decompilation lives in `improvements/bm-loader-rebuild/decompiled/` (gitignored research material — the recovered `playlistparse.py` covering `Song.loadSong`/`saveSong` and `PlayList.loadPlaylist`/`savePlaylist` is the most useful reference for ambiguous format questions). Treat it strictly as a reading reference: never paste from it, and re-describe any insight in our own words in `SPEC.md` or comments. This is a clean-room rebuild.

## Reliability principle (read first)

**This app drives a live performance rig.** Eric's band uses the BandMate hardware on stage; a broken export or corrupted `.jcs` means a broken show. Bias toward:

- **Stable, deterministic writers** for the three file formats and the USB export pipeline. If a change risks byte drift against BM Loader's output, validate via [docs/COMPAT-TEST.md](docs/COMPAT-TEST.md) (working-folder parity) and/or [docs/EXPORT-PARITY-TEST.md](docs/EXPORT-PARITY-TEST.md) (USB-export parity) before merging.
- **Lenient reads, strict writes.** Tolerate anything BM Loader has ever emitted; emit only the canonical form.
- **Idempotent file operations.** Re-running a save / scan / export against an unchanged working folder should be a no-op. Avoid timestamp-driven changes that creep into diffs.
- **No silent destruction.** Renames, duplicates, deletes, and "clean up unreferenced files" actions go through confirm dialogs and surface what they'll touch beforehand.
- **No half-finished features on `main`.** Active dev is single-user; an in-progress refactor that ships broken is a Friday-night problem at rehearsal. Prefer behind-a-toggle to "I'll finish it next PR."

When weighing engineering tradeoffs, "would this be safe at 8:55pm five minutes before doors" is the right framing.

## Phase model

Lifecycle is encoded in [src/lib/appPhase.ts](src/lib/appPhase.ts) (`APP_PHASE` constant) and surfaced in Settings → About. Flip by hand when crossing thresholds — criteria live in [docs/ROADMAP.md](docs/ROADMAP.md):

- **alpha** *(current)* — active feature development, single user, breaking changes OK at any minor bump.
- **beta** — private dogfooding with the band + Joe at JoeCo. Criteria in [ROADMAP § Beta](docs/ROADMAP.md#criteria): BM Loader working-folder backwards compatibility, USB export byte parity on macOS + Windows, BandMate-hardware playback validated, Windows build validated, in-app feedback path, no `blocking` backlog items.
- **stable (1.0+)** — public GitHub Releases. Criteria in [ROADMAP § v1](docs/ROADMAP.md#v1x--initial-release-stable).

Items tagged `[Beta blocker]` in [BACKLOG.md](BACKLOG.md) must ship before flipping `APP_PHASE` to `"beta"`.

## Per-PR version-bump workflow

**Every PR bumps the version.** Run one of:

```bash
pnpm bump:patch    # fix-only PR, no behavior change
pnpm bump:minor    # new feature / new UI surface / behavior change (default during alpha)
pnpm bump:major    # post-1.0 only — breaking changes
```

The script ([scripts/bump-version.mjs](scripts/bump-version.mjs)) writes all four version files in lockstep: `src-tauri/tauri.conf.json` (canonical), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `package.json`. Amend the bump into your commit, then update [CHANGELOG.md](CHANGELOG.md) by adding a new `## [<version>] — YYYY-MM-DD` section **directly below** the `## [Unreleased]` heading (as its next sibling, *not* as content nested under it — `[Unreleased]` stays an empty placeholder; per-version entries get their own `## [X.Y.Z]` section). Group items under `### Added` / `### Changed` / `### Fixed` / `### Documentation` / `### Notes` per Keep a Changelog. After merge to `main`, tag `v0.X.Y` and `git push --tags` so a working folder or bug report can be traced back to a build. Full details in [docs/VERSIONING.md](docs/VERSIONING.md).

## Common commands

```bash
pnpm install            # one-time, pulls JS deps; Rust deps build on first `tauri dev`
pnpm tauri dev          # native window with HMR; first run is slow (~5 min for cargo)
pnpm tauri build        # produces .dmg in src-tauri/target/release/bundle/dmg/
pnpm dev                # frontend-only (regular browser, no Tauri shell — limited utility)
pnpm test               # vitest, runs the codec round-trip tests against src/codec/__fixtures__/
pnpm test -- jcm        # filter to one file (vitest pattern match)
pnpm typecheck          # tsc --noEmit; project also runs `tsc -b` in `pnpm build`
pnpm bump:patch|minor|major   # see docs/VERSIONING.md — must run before each merge
```

Vitest is configured for Node environment (codec is pure-functional and DOM-free). There is no JS lint step. The Rust side has no separate test command — `cargo test` is available but not currently wired into scripts.

## Dev server

Eric runs `pnpm tauri dev` in a separate terminal he manages — do not start, stop, or restart it from Code sessions. Vite HMR picks up `src/**/*` edits automatically; assume your changes are live in the running app within a few seconds of save.

Restart is needed (Eric's call, not yours) when changing:
- `tauri.conf.json` — window config, plugins, version display
- `Cargo.toml` — Rust dependencies
- `vite.config.ts` — Vite plugin/build config

`src-tauri/src/*.rs` changes trigger a cargo rebuild automatically via Tauri's watcher; no manual restart.

If a change might require a restart, surface that in your response so Eric can do it on his side. Don't try to verify changes by launching a dev process — `pnpm typecheck` and `pnpm test` cover the automated verification; Eric reviews the running app visually as part of PR review.

## Architecture

**Two-process app: JS frontend in the webview, Rust backend behind Tauri commands.** The boundary is deliberate:

- **All filesystem I/O lives in Rust** ([src-tauri/src/lib.rs](src-tauri/src/lib.rs), invoked from JS via `@tauri-apps/api`'s `invoke`). Tauri's JS-side `fs` plugin gates paths to allow-listed scopes, but the working folder is user-chosen and arbitrary, so we do all reads/writes in Rust commands and sidestep scope-gating. Examples: `init_working_folder`, `scan_working_folder`, `read_text_file`, `write_text_file`, `list_audio_files`, `probe_wav`, `copy_into_folder`, `create_song`/`create_playlist`/`create_track_map`, `rename_*`/`duplicate_*`/`delete_*`, `export_to_usb`, `run_dot_clean`, `eject_volume`, `clean_midi_file`. The JS wrappers in [src/fs/workingFolder.ts](src/fs/workingFolder.ts) are the only place that imports Tauri primitives.
- **File-format codecs live in TypeScript** ([src/codec/](src/codec/), pure-functional, no Tauri imports). Rust hands raw text to JS; JS parses, edits, and writes back text; Rust persists. This keeps a single source of truth for `.jcs`/`.jcp`/`.jcm` encoding and lets the codec run under vitest in Node without a Tauri shell. WAV header probing is the lone exception — that's a Tauri command using the `hound` crate.

**`SPEC.md` is the authoritative reference for on-disk formats.** Anything you change in the codec (`src/codec/{jcm,jcs,jcp}.ts`) must round-trip through the fixtures in [src/codec/__fixtures__/](src/codec/__fixtures__/) (real files copied from Eric's working USB) and match the SPEC's documented conventions:

- `.jcm`: write CRLF without trailing newline (matches stock JoeCo); accept either CRLF or LF on read. Always 25 channels (24 audio + MIDI slot at index 24); unused slots are empty strings.
- `.jcs`: XML-ish tag-soup, 4-space indent on write; canonical write order is `<srate>`, `<length>`, then `<file>` entries, then optional `<midi_file>` at the end. `<length>` is samples (not seconds) and is derived from the longest assigned WAV on save. Lenient on read (whitespace, mixed line endings, tag order); strict on write.
- `.jcp`: same dialect; songs in display order, sample-rate field must match the songs.

**The unbreakable invariant: byte-level parity with BM Loader's writers for the deterministic portions of `.jcs`/`.jcp`/`.jcm` is a beta criterion.** Don't introduce stylistic changes (whitespace, attribute order, line endings) without re-running the [docs/COMPAT-TEST.md](docs/COMPAT-TEST.md) audit and confirming BM Loader still reads our output cleanly.

**Frontend state: a single reducer in Context** ([src/state/AppState.tsx](src/state/AppState.tsx)). The reducer is exhaustive (TS `never` check at the bottom). Selection model: one sidebar selection (song / playlist / trackMap) + an editor sub-selection (`channelSelection` for the song editor's row highlight, `playlistRowSelection` for the playlist editor's). The top-level ESC handler in [src/App.tsx](src/App.tsx) clears editor sub-selections first, then falls back to clearing the sidebar selection via `requestClearSelection`. The unsaved-changes guard intercepts at `requestSelect`/`requestClearSelection` — editors register their dirty status through `registerDirtyEditor`. Sidebar/editor navigations from user input should call those request helpers, not dispatch `select`/`clear_selection` directly.

**Working Folder** is the workspace concept: a single user-chosen directory containing `bm_media/{bm_sources,bm_trackmaps}/` that mirrors the eventual USB layout. The same folder must be safe to switch between BM Loader and BandMate Studio (Beta criterion 1); we use a hidden `.bandmate-studio.json` sidecar inside each song folder for Studio-only metadata that BM Loader's scan ignores by extension. The last-used path is persisted in localStorage and restored on launch ([src/state/persistence.ts](src/state/persistence.ts)).

**Sidebar/editor file layout:** [src/components/](src/components/) holds the three top-level editors (`SongEditor.tsx`, `PlaylistEditor.tsx`, `TrackMapEditor.tsx`) and their dialogs (`NewSongDialog`, `NewPlaylistDialog`, `NewTrackMapDialog`, `ExportToUsbDialog`, `ImportTrackMapDialog`, `RenameDialog`, etc.). [src/lib/](src/lib/) contains framework-agnostic helpers (drag-drop, view transitions, change-log diffing, source-file matching, export filtering, snapshot diffing).

## Conventions worth knowing

- **AppleDouble files (`._*`) and `.DS_Store`** break BandMate's USB UI. The USB export pipeline shells out to `dot_clean -m` on macOS automatically (`run_dot_clean` in lib.rs); the project's own [`.gitignore`](.gitignore) also excludes them.
- **Stock BM Loader can produce non-byte-stable `.jcs` output** — saving identical content twice writes different bytes. Our writer is the more stable reference; don't try to "match" that quirk.
- **MIDI files imported into song folders** are run through `midly` to strip non-essential meta events (Kemper-bound MIDI tracks must contain only events the device responds to). See `clean_midi_file` / `is_midi_clean` commands and [src-tauri/src/midi.rs](src-tauri/src/midi.rs).
- **Tauri bundle identifier matters for the macOS app icon** — set in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json). Don't let it revert to the Tauri default placeholder.
- **The `_tmp_*` file** at the repo root is harmless leftover scaffolding; don't commit anything to it.

## Design conventions

Recurring decisions that aren't enforced by tooling and aren't obvious from reading any single file. New work should respect them unless there's a strong reason to revisit and Eric agrees.

- **Prefer "allow with a visible warning" over "prevent the bad state entirely."** BM Loader hard-blocks two operations BMS deliberately allows: changing a song's sample rate after files are assigned (BMS surfaces a rate-mismatch warning on affected rows), and — once we build it — editing LVL/PAN/mute on assigned channels. The pattern is: trust the user to recognize the warning and act on it. The only exception is operations that could irrecoverably corrupt user data, of which there are currently none.

- **`docs/ROADMAP.md` is the *public* criteria list; personal gates aren't in it.** Before flipping `APP_PHASE` from alpha → beta or beta → stable, Eric runs two additional gates not captured in ROADMAP: multi-rehearsal validation in the live rig, and a Q&A pass with Joe at JoeCo on the BM Loader compatibility surface. These are intentionally not public criteria (they aren't externally verifiable). Do not propose flipping the phase based solely on the public criteria passing — surface that the personal gates are also needed.

- **Channel assignment is click-to-assign, not drag-drop.** The current UX is *select a channel row, then click a source file* (the inverse direction is not supported). Drag-drop is a deferred Phase 3g feature, intentionally not built yet. The Smart Import confirmation dialog, on-row action buttons, and Source Folder click handlers are all designed around this model. New features touching channel assignment should follow the click model; if drag-drop is ever added, it goes in as a coordinated change across all the surfaces, not piecemeal.

- **The source folder is the user's working area; BMS treats it as read-only.** BMS only writes to the *song folder* (under `bm_media/bm_sources/<song>/`), never to the user's source folder (typically a Logic / Pro Tools export directory). Smart Mapping reads source files but never moves, renames, or deletes them. The user's Logic export workflow continues to own that folder. Orphan-stem cleanup in *song folders* is opt-in via the explicit "Clean up unreferenced files" affordance — never automatic.
