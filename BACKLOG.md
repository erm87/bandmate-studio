# BandMate Studio — backlog

Running list of polish / refinement / feature ideas captured outside the release-level roadmap. Release-level goals live in [docs/ROADMAP.md](docs/ROADMAP.md); this file is the working list of items waiting to be picked up.

Items tagged **[Beta blocker]** in their heading must ship before flipping `APP_PHASE` to `"beta"` (see [docs/ROADMAP.md § Beta criteria](docs/ROADMAP.md#criteria)).

Newest entries on top.

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


