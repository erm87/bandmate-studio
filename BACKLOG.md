# BandMate Studio — backlog

Running list of polish / refinement / feature ideas captured outside the release-level roadmap. Release-level goals live in [docs/ROADMAP.md](docs/ROADMAP.md); this file is the working list of items waiting to be picked up.

Items tagged **[Beta blocker]** in their heading must ship before flipping `APP_PHASE` to `"beta"` (see [docs/ROADMAP.md § Beta criteria](docs/ROADMAP.md#criteria)).

Newest entries on top.

---

## Sidebar — keyboard arrow navigation when no editor sub-selection is active

**Where:** Top-level keyboard handler in `App.tsx` (lives next to the existing ESC handler that clears editor sub-selections before falling back to clearing the sidebar selection). `Sidebar.tsx` exposes the ordered lists of songs / playlists / track maps. `AppState` already owns `sidebarSelection` (kind + value) and the editor sub-selections (`channelSelection`, `playlistRowSelection`).

**Idea:** When the user has an item selected in the sidebar but no sub-selection in the editor (no channel highlighted in the song editor, no row highlighted in the playlist editor), ↑/↓ should walk through the sidebar items in the *same category* as the current selection. Up at the top edge is a no-op (don't wrap), down at the bottom edge is a no-op. Same gating as the ESC chain: the keyboard handler only engages when no editor sub-selection is consuming arrows itself.

**Why:** The fast common-case navigation today is *click each song / playlist / track map in the sidebar*. For users running through a working folder to spot-check artifacts, arrow-key walking is significantly faster — no mouse, eyes stay on the editor pane that updates as you walk. The ESC chain already establishes "the sidebar selection is a top-level thing that's distinct from the editor's sub-selection"; arrow navigation extends that mental model from "I can clear it with ESC" to "I can walk it with arrows."

**Implementation notes:**
- Gating mirrors the ESC chain. Pseudocode for the top-level handler: `if (editor.channelSelection != null || editor.playlistRowSelection != null) return; // editor consumes arrows`. Otherwise, dispatch `select_sidebar_neighbor({ delta: -1 | 1 })`.
- The category to walk within: derive from `sidebarSelection.kind` (`"song"` / `"playlist"` / `"trackMap"`). Don't cross category boundaries — ↓ at the last song shouldn't jump into playlists. Stop at the boundary; let the user click into the next section if they want to switch.
- Ordering: match the visible sidebar order. For songs / playlists that's user-defined; for track maps the templates group sits above the user-defined ones (per the `Template` badge convention). Walk through the section in display order, including templates.
- Unsaved-changes guard: route the move through `requestSelect` (the same primitive used elsewhere) so an unsaved editor blocks the navigation with the existing confirm dialog. Don't bypass the dirty check.
- Focus behavior: the sidebar list doesn't need to *gain* focus for arrows to work — the top-level handler engages regardless of focus, as long as no editor sub-selection is active. If a text input is focused (e.g. user is renaming a song), arrow keys should belong to that input — check `document.activeElement` for editable surfaces and let those win.
- Cursor visibility: when the selection moves, scroll the sidebar so the newly-selected item stays in view (sidebar may be longer than the viewport once a band has 50+ songs).

**Open questions:**
- Should ↑/↓ at a section boundary *visibly fail* (brief shake / no-op feedback) or be silent? Lean silent — matches how arrow nav works elsewhere; the boundary is implicit.
- Cmd+↑ / Cmd+↓ to jump to the section's first / last item? Useful for long lists, mirrors macOS conventions. Defer until the basic ↑/↓ is settled; ship as a follow-up if it earns its keep.
- Tab to walk *across* sections (Songs → Playlists → Track Maps)? Probably not — Tab has standard meaning and overloading it is risky. If cross-section traversal becomes a need, J/K or `[` / `]` style shortcuts are safer.

**Captured:** 2026-05-14

---

## Song editor — stopwatch icon on all rows tied for longest duration

**Where:** `SongEditor.tsx` longest-file detection (search for `longestFilename` — currently a `string | null`). `ChannelGrid.tsx` `AudioRow` / `MidiRow` `isLongest` prop (currently a `boolean` derived from `filename === longestFilename`).

**Idea:** Today only one channel row gets the stopwatch icon — the first/only file whose duration matches the song's `<length>`. When multiple media files share the maximum length (e.g. a click track and a backing stem both exported at the same exact length, or a WAV and the MIDI ending at the same sample boundary), every tied file should show the stopwatch, not just one.

**Why:** The stopwatch indicates "this file determines the song's overall duration." When ties exist, the *set* of files matters — any of them ending earlier wouldn't shorten the song, but all of them ending later would extend it. Surfacing only one is misleading: it implies the others are shorter when they're actually equal. For users debugging a length issue ("why is this song running 3 seconds longer than I expect?"), seeing all the tied rows points them at the right candidates immediately.

**Implementation notes:**
- Compare durations in **samples**, not seconds. `song.lengthSamples` is an integer (per the codec); each file's `lengthSamples` from the WAV header probe is also integer; MIDI length converted to samples likewise. Integer equality avoids floating-point precision traps where two files round to the same `m:ss` but differ by a few samples (or vice versa).
- Replace `longestFilename: string | null` with `longestFilenames: Set<string>` (or equivalently a `Set<channel>` keyed by channel index — pick whichever flows more naturally through `ChannelGrid`'s prop passing).
- Update detection logic to pass through all files and collect those whose sample count equals the song's max. The max itself is still derived from the longest file (or `song.lengthSamples` directly).
- Each `AudioRow` checks `longestFilenames.has(filename)` (or `.has(channel)`); same for `MidiRow`. Tooltip can stay the same — "Longest file in this song (m:ss) — its length sets the song's overall duration." Singular phrasing reads fine even when multiple rows show it; the icon's presence on multiple rows tells the story.
- MIDI participation: the F-2 fix made `<length>` include MIDI duration. If a MIDI file ties with WAVs at the max, the MIDI row gets the stopwatch alongside the tied audio rows. Already partially handled — just need the set membership check rather than the single-filename equality.
- Per-row change-dot precedence: the change dot still wins over the stopwatch on individual rows (per the precedence flip in 0.7.1). Multiple tied rows that are all unedited will show stopwatches; if one is edited, that row shows the dot and the others keep their stopwatches. No special-case needed — the existing precedence applies row-by-row.

**Open questions:**
- Visual styling unchanged? Probably yes — multiple identical icons is the correct visual story for "these are all the same length." If it gets noisy in practice (a song with 8 stems all exported to identical length showing 8 stopwatches), consider a subtler treatment for ties only (smaller icon, lighter color, or a numeric badge like "× 3" on one row). Cross that bridge after seeing it in real working folders.
- Tooltip wording: keep singular ("Longest file in this song"), pluralize ("One of the longest files…"), or split based on count? Lean keep-singular — the on-screen evidence of multiple stopwatches conveys the multiplicity without prose, and the tooltip's existing copy reads correctly for each individual row regardless of how many others share the property.

**Captured:** 2026-05-14

---

## Playlist editor — Duration column in the song list

**Where:** `PlaylistEditor.tsx` → `PlaylistSongList` (around line 773). The grid template `COLS = "grid-cols-[40px_1fr_auto_72px]"` (row # / name / status pill / actions) needs a new column for the per-song duration; same component owns the header and the row renders.

**Idea:** Show each song's duration (`m:ss`) as a new column in the playlist's ordered-song list. Sums up automatically into a footer/header total so the user can see the playlist's full runtime at a glance.

**Why:** Today the playlist editor shows only song names and status pills — no length information. Bands typically build set lists with a target runtime in mind ("we have a 45-min slot, need ~9 songs"). Per-song duration plus a roll-up total turns the playlist editor into a real set-list-planning tool instead of just an ordered-name list. Mirrors the song-duration affordance already in the song editor's caption (`3:22 · 5 files`).

**Implementation notes:**
- Duration source: each referenced song's `.jcs` exposes `<length>` (samples) + `<sample_rate>`. Duration in seconds = `lengthSamples / sampleRate`. Format with the existing `formatDuration` helper in `ChannelGrid.tsx` — lift it to `lib/duration.ts` if it doesn't already live somewhere shared.
- Lookup strategy: don't parse all referenced songs on every playlist-editor render. Two options:
  - **A. Cache on the workspace state.** Whatever already drives the sidebar's song inventory (probably `AppState`) holds song metadata for songs in the working folder. Add `durationSeconds` to that metadata so the playlist list can read it synchronously. Best long-term — other surfaces (sidebar tooltip, USB-export confirm) will want this too.
  - **B. Per-playlist-open async fetch.** Parse each referenced song on playlist open, memoize for the lifetime of the editor mount. Cheaper to implement; fine if A is a bigger lift.
- Missing-song handling: a playlist can reference a song the user has since deleted (status pill already surfaces this as a warning). The duration column should render `—` for missing songs and exclude them from the roll-up total.
- Header total: render in the existing `<header>` near the song count, e.g. `5 songs · 23:14`. Keep the existing song-count text — runtime is additive.
- Sample-rate mismatch: if a referenced song's sample rate doesn't match the playlist's, the duration computation is still correct (it's just `samples / rate`), so no special-case needed. The existing rate-mismatch warning is separate from this column.
- Grid template update: `grid-cols-[40px_1fr_56px_auto_72px]` — slot a fixed-width duration column between name and status. 56px fits `mm:ss` mono-tabular cleanly; left/right alignment TBD during build.

**Open questions:**
- Should the duration column be sortable / drive a reorder? Probably no — the playlist order IS the set-list order, surfacing duration for read-only awareness is the value. Don't overload.
- Tooltip on the column / total — worth showing "longest media file" attribution? Maybe, but the row's existing tooltip is already busy; the duration value alone is probably enough.

**Captured:** 2026-05-14

---


