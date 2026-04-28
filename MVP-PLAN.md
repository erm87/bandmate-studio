# BandMate Studio — MVP-v0.1 plan

Phased work checklist for the first usable build. Each phase is meant to be self-contained, testable in isolation, and end with something Eric can click on. We don't move past a phase until it's working.

The driving principle for v0.1 is **drop-in replacement**: BandMate Studio should produce a USB stick that the BandMate hardware reads identically to one produced by JoeCo's BM Loader, while being a substantially nicer experience for the user.

---

## Phase 0 — Project scaffold ✅ (this session)

- [x] Decide tech stack: Tauri + React + TypeScript + Tailwind
- [x] Write SPEC.md, README.md, MVP-PLAN.md, DEV-SETUP.md
- [ ] Lay down package.json, vite.config.ts, tailwind.config.js, tsconfig.json, index.html
- [ ] Lay down src-tauri/Cargo.toml, tauri.conf.json, build.rs, src/main.rs
- [ ] Placeholder src/main.tsx + App.tsx that says "BandMate Studio" so we can confirm `pnpm tauri dev` runs end-to-end
- [ ] `.gitignore`

**Exit criterion:** Eric runs `pnpm install && pnpm tauri dev` on his Mac, sees a blank app window with "BandMate Studio" text and no console errors.

---

## Phase 1 — File-format codec library

A pure-functional library (no UI) that reads and writes the three formats from SPEC.md, plus probes WAV headers. Tested first with the existing playfile USB as input.

- [ ] **`.jcm` parser/writer** in TypeScript
  - Parse plain text, accept `\n` or `\r\n`
  - Write CRLF on save (compatibility convention)
  - Round-trip: parse `default_tm.jcm` and `erictest_tm.jcm`, re-write, byte-compare
- [ ] **`.jcs` parser/writer** in TypeScript
  - Parse the XML-ish dialect (use `fast-xml-parser` or hand-roll)
  - Write canonical order: `srate`, `length`, then `<file>` entries
  - Round-trip: parse `Buffy/Buffy.jcs`, re-write, structurally compare (whitespace-insensitive)
- [ ] **`.jcp` parser/writer** in TypeScript
  - Same dialect as `.jcs`
  - Round-trip: `May v3.jcp`
- [ ] **WAV probe** as a Tauri command (Rust side using `hound`)
  - Input: file path
  - Output: `{ channels, sample_rate, duration_samples, duration_seconds }`
  - Used to detect stereo files (channels > 1) and to compute `<length>` on song save
- [ ] **Tests**: a small fixtures folder with copies of real `.jcs`/`.jcp`/`.jcm` from the production USB; round-trip every one of them through parse → write → parse and assert structural equivalence.

**Exit criterion:** all of Eric's existing `.jcs`/`.jcp`/`.jcm` files round-trip cleanly through the codec, and we can probe an arbitrary WAV file from JS.

---

## Phase 2 — Working Folder + Project state

The workspace concept: a single folder on disk that contains `bm_media/`. All operations are scoped to it.

- [ ] **First-run experience**: empty state with a single "Choose Working Folder" button (native folder picker via Tauri dialog).
- [ ] **Folder validator**: when a folder is chosen, check it's writable and either has a `bm_media/` subtree or is empty. Initialize `bm_media/bm_sources/` and `bm_media/bm_trackmaps/` on first use.
- [ ] **Sticky setting**: remember the last-used Working Folder in app state (Tauri's `app_data_dir`, key `working_folder`). Reopen there on next launch.
- [ ] **Working Folder switcher** in the app chrome (top bar, single click — no two-step Browse→Set).
- [ ] **Empty state for each section** once a Working Folder is set: songs list, playlists list, track maps list — initially empty, populated by scanning `bm_media/`.

**Exit criterion:** Eric points at his existing `bm-stick/` working folder, sees his songs/playlists/track maps appear in the sidebar.

---

## Phase 3 — Songs list and Song editor

The most-used screen. Replaces "Track Loader" tab in BM Loader.

- [ ] **Songs list view** (sidebar or main panel — settle UX in Phase 2 design pass)
  - Each row: song name, sample rate, duration (computed from `<length>` ÷ `<srate>`), file count
  - Click → open Song editor
  - Right-click → Rename / Duplicate / Delete
  - "+ New Song" button at top
- [ ] **Song editor** (replaces the BM Loader Track Loader screen)
  - Editable Song Name (in-place)
  - Sample-rate radio (44.1 / 48 kHz) — **does NOT bug out and revert to 44.1 like BM Loader's** (Eric's issue #4)
  - Channel grid: 25 rows (24 audio + MIDI), each row shows track-map name + assigned filename + lvl + pan + delete
  - Drag-drop a WAV from a "Source files" pane on the right into a row to assign it
  - Drag-drop within the channel grid to reorder (Eric's issue #2)
  - **Delete key** removes the highlighted row's file assignment (Eric's issue #3)
  - **Cmd+S** saves the `.jcs` file (and copies any newly-assigned WAVs into the song folder)
  - Stereo source files visually flagged red and cannot be dropped onto a channel (recovers BM Loader's documented behavior that's broken)
- [ ] **New Song wizard**
  - Modal: enter name, pick sample rate, pick source folder (where WAVs live)
  - Source files pane populates from that folder
  - 48 kHz works correctly (regression test for issue #4)
- [ ] **Track-map picker** at the song level (defaults to the playlist's track map if entered via playlist; otherwise the user picks)

**Exit criterion:** Eric creates a new song from scratch, drag-drops WAVs into channels, saves, opens the saved `.jcs` in a text editor and sees correct content; reopens in BandMate Studio and the assignments come back.

---

## Phase 4 — Playlists

Replaces "Playlist Editor" tab.

- [ ] **Playlists list view** (sidebar)
  - Each row: playlist name, total duration, song count, sample rate, track map
  - Click → open Playlist editor
  - Right-click → Rename / Duplicate / Delete
  - "+ New Playlist" button
- [ ] **Playlist editor**
  - Editable Playlist Name, sample rate, track map dropdown
  - Songs list with **drag-to-reorder** (Eric's issue #2)
  - Drag a song from the Working Folder's available-songs list into the playlist to add
  - Delete key removes from playlist (Eric's issue #3)
  - Validation: warn if any `<song_name>` doesn't have a matching folder under `bm_sources/`; warn if mixed sample rates
  - Cmd+S saves `.jcp`
- [ ] **Available-songs pane**: shows all `bm_sources/<folder>/` entries that aren't already in this playlist; drag to add.

**Exit criterion:** Eric reproduces his "May v3" playlist from scratch, saves it, byte-compares against his existing `May v3.jcp` (modulo whitespace).

---

## Phase 5 — Track Maps

Lower-frequency surface, but needed.

- [ ] **Track Maps list** (sidebar)
- [ ] **Track Map editor**: simple list of channel labels, drag-to-reorder, edit-in-place, delete row, add row at bottom
- [ ] **Cmd+S** saves `.jcm` (CRLF newlines per SPEC)
- [ ] **Default templates** (default, stems, plus a "Brigades-style" matching Eric's current `erictest_tm.jcm`)

**Exit criterion:** Eric edits a label in his track map, saves, sees the new label propagate to song-editor channel rows on next open.

---

## Phase 6 — USB Export

The "Download to USB Stick" workflow. Replaces the Uploader tab's first row.

- [ ] **USB drive picker**
  - List mounted volumes (Tauri command: shell out to `df -h` or use Rust `sysinfo` crate)
  - Show free space, filesystem type
  - Warn if FAT32 (BandMate is fine with exFAT or FAT32; just note)
- [ ] **Pre-export validation**
  - All songs in any playlist actually exist as folders
  - No stereo files snuck in
  - Total size fits on the drive
- [ ] **Copy with progress**
  - Background thread (Tauri's tokio runtime; the UI never freezes — this fixes Eric's issue #5)
  - Per-file progress + overall progress (a UX improvement over BM Loader)
  - Skip files unchanged since last export (size + mtime check) — *bonus fast-path*
- [ ] **dot_clean integration on macOS** (Eric's issue #8)
  - After copy, automatically run `dot_clean -m <usb mount point>`
  - Show as a step in the progress UI ("Cleaning AppleDouble files…")
  - Skip on Windows (no-op)
- [ ] **Eject prompt** at the end with a button to eject from the app

**Exit criterion:** Eric runs an export to his Lexar stick, the BandMate boots from it cleanly, no `._*` files in the BandMate's playlist UI.

---

## Phase 7 — Polish + bug-bash

- [ ] **App icon**: real `.icns` with Brigades-flavored design (or just JoeCo-borrowed for now); set `CFBundleIdentifier` to `com.brigades.bandmate-studio` so macOS doesn't lose it (Eric's issue #7)
- [ ] **Dark mode** support (Tailwind + system preference)
- [ ] **Keyboard shortcuts**: Cmd+S, Cmd+Z (undo for in-progress edits), Cmd+W (close window), Cmd+,
- [ ] **Onboarding**: one-screen intro on first launch explaining Working Folder + the three nouns (Songs / Playlists / Track Maps)
- [ ] **About box** with version number, link to BandMate User Manual, link to project repo
- [ ] **Sentry-style error reporting** OR at minimum a "Copy diagnostic info" button that dumps app state and recent error log to the clipboard (helps debugging without remote access)

**Exit criterion:** Eric uses BandMate Studio exclusively for a week of rehearsals/shows without falling back to JoeCo's BM Loader.

---

## Out of scope for v0.1 (deferred to v0.2+)

- **Save As** — the save-confirm dialog gains a "Save as new" option that
  duplicates the song folder + `.jcs` under a user-chosen name with the
  current edits applied, leaving the original untouched. Same machinery
  applies to Playlists and Track Maps.
- **Duplicate song / playlist** — right-click on a sidebar row → "Duplicate"
  creates an independent copy under a derived name (e.g., "Buffy 2"),
  copying the folder + all WAVs for songs, or the `.jcp` for playlists.
  Selection auto-switches to the duplicate. Shares folder-copy machinery
  with Save As.
- **Song renaming** — currently the song name in the header is read-only.
  Renaming requires a folder rename + `.jcs` rename + updating any
  playlist `<song_name>` references. Doable, just needs careful handling.
- **Undo History menu** — native macOS app menu "Edit" with an
  "Undo History" item that opens a panel listing the last N edits in
  the song editor's past stack. Lets the user jump back to a specific
  snapshot rather than mashing Cmd+Z. Today's surfaces are Cmd+Z /
  Cmd+Shift+Z and the toolbar buttons only.
- **Dark-mode channel-row selection contrast** — when a row in the
  channel grid is selected in dark mode, the `bg-brand-950/30`
  highlight + `text-brand-100` filename combination washes out: the
  filename becomes very hard to read against the brand-tinted
  background. Tone the highlight down and/or pick a more legible text
  color for selected dark-mode rows.
- Bulk editing across multiple songs (Eric's issue #9)
- "Diff against USB" view: visual indicator of which songs on the USB are stale vs the working folder
- BandMate firmware update workflow (the second/third rows of BM Loader's Uploader tab)
- Code-signed and notarized macOS distribution (TestFlight-style; for now, ad-hoc builds)
- Windows packaging (Tauri makes this almost free, but we defer until Eric or Joe needs it)
- Translations / internationalization
- Per-track gain envelope / fades / crossfades — this is a serious feature that would deserve its own design pass

---

## Open design decisions for Phase 2/3

1. **Sidebar IA:** flat list of all songs + all playlists + all track maps in one sidebar (like Apple Music), or three separate top-level sections with their own list views?
2. **Save semantics:** auto-save on edit, or explicit Cmd+S? The BM Loader uses explicit save which is friendlier for "I'm experimenting" workflows. Let's match that.
3. **Undo scope:** local to the edit (per-field undo within Song editor), or app-wide (last 50 actions, like a real DAW)?
4. **Confirm-on-delete:** soft confirm, or "did you mean to do this" undo toast? Toast is more modern; confirm is safer.

I'll bring these back as concrete proposals when we reach Phase 2.
