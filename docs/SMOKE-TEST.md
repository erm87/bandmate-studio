# BandMate Studio — Smoke Test Checklist

A dogfood checklist for validating BandMate Studio against a real rig
before a live show or release tag. Runs in roughly this order, with
the cheapest checks first and the device validation last.

Each item marks pass / fail / N/A inline. Annotate with notes and date
when you run it; we keep the doc updated rather than starting fresh.

**Last run:** _(not run yet)_
**Build:** _(commit hash or version tag)_

---

## 0. Pre-flight

Run before any of the test sections.

- [ ] App launches, no console errors visible in dev tools
- [ ] Working folder restores from last session (or empty state shows
      cleanly if first launch)
- [ ] Sidebar populates with songs / playlists / track maps from the
      working folder
- [ ] No "scan failed" banner

If pre-flight fails, stop and report — the rest depends on these.

---

## 1. Settings page

The new gear-icon entry point and the three sections.

### 1a. Entry point
- [ ] Gear icon visible in the top bar, right of the Export button
- [ ] Clicking opens the Settings modal
- [ ] ESC closes the modal
- [ ] Click outside the modal closes it

### 1b. Appearance
- [ ] All three cards (Light / Auto / Dark) render with mini previews
- [ ] Auto card shows the split light/dark preview
- [ ] Selecting Light flips the app to light mode immediately
- [ ] Selecting Dark flips to dark mode immediately
- [ ] Selecting Auto follows the OS preference
- [ ] Toggling macOS System Settings → Appearance from Light to Dark
      while Auto is selected updates the app live (no reload needed)
- [ ] Choice persists across app relaunch

### 1c. Defaults
- [ ] Default sample rate chip selection persists across relaunch
- [ ] Opening **New Song** dialog: the sample-rate chip pre-fills to
      the Settings default
- [ ] Opening **New Playlist** dialog: same

### 1d. MIDI
- [ ] "Auto-clean imported MIDI files" toggle is **off** by default on
      a fresh install
- [ ] Toggle to **on** — if any song folders have dirty MIDI, the
      retroactive confirm dialog appears with the right counts
- [ ] Clicking **Skip** in the retroactive dialog does NOT clean
      anything; the toggle stays on; status text reflects skipped
- [ ] Clicking **Clean Now** cleans the listed files; status text
      updates with the cleaned count
- [ ] Toggle to **off** does not prompt; future imports are not cleaned
- [ ] Choice persists across app relaunch

---

## 2. Song editor

Open an existing song (Ctrl/Cmd-clicking a song row in the sidebar).

### 2a. Header
- [ ] Long song names no longer truncate aggressively (e.g. "Small
      Time Crooks" renders in full at typical window widths)
- [ ] Caption row shows duration · file count beneath the title
- [ ] Sample-rate chip reflects the song's sample rate
- [ ] Track Map dropdown shows the assigned track map; switching to a
      different one marks the song dirty

### 2b. Channel grid
- [ ] All 25 rows render (24 audio + 1 MIDI at the bottom)
- [ ] Selected channel highlights in the new richer brand blue
- [ ] Tabbing through channel rows shows the new cyan focus rings
- [ ] Click a row → ↑ / ↓ / × buttons appear
- [ ] Cmd-↑ / Cmd-↓ moves the selected channel
- [ ] Delete / Backspace clears the selected channel
- [ ] Long file names truncate cleanly without overflowing the row

### 2c. Source files pane
- [ ] Tab bar shows Song Folder + Source Folder
- [ ] Song Folder tab lists files already in the song folder
- [ ] Source Folder tab is empty if no source folder set; "Choose
      folder" CTA works
- [ ] After picking a source folder, .wav and .mid files appear with
      correct severity tags (clean / warning / error / midi)
- [ ] Hover tooltips show full file specs

### 2d. Save flow
- [ ] Edit something → dirty dot appears next to the title
- [ ] Cmd-S opens the save confirm dialog
- [ ] **Save** writes to disk and clears the dirty dot
- [ ] **Save as new** prompts for a name (pre-filled "Foo 2"), creates
      a duplicate, opens the new song
- [ ] **Cancel** closes the dialog without saving

### 2e. Undo/redo + history
- [ ] Cmd-Z undoes the last edit
- [ ] Cmd-Shift-Z redoes
- [ ] Clock icon in the header opens the Undo History panel
- [ ] Opt-Cmd-Z also opens the panel (macOS Option swallow check)
- [ ] Each entry shows a short diff label (e.g. "ch 3: kick.wav",
      "Moved bass.wav to ch 5")
- [ ] Hovering an entry shows the full untruncated label as a tooltip
- [ ] Clicking an entry jumps to that snapshot
- [ ] "Current" pill marks the current snapshot
- [ ] "Saved" pill marks the baseline (last-saved snapshot)

---

## 3. Playlist editor

Open an existing playlist.

### 3a. Header + caption
- [ ] Title gets full width without truncating
- [ ] Caption row shows song count · total duration

### 3b. Song list
- [ ] All assigned songs render in order
- [ ] Click a row → arrow / × buttons appear on that row
- [ ] Drag-to-reorder works
- [ ] Available Songs pane shows unassigned songs

### 3c. Save / undo / history
- [ ] Same checks as Song editor (save, save-as, undo, redo, history)

### 3d. Trackmap parity
- [ ] Editing a playlist with a missing trackmap reference shows
      the orphan option `<filename> (missing)` in the dropdown
- [ ] Saving with no trackmap selected (empty) writes a .jcp without
      a `<trackmap>` element (verify by opening the file in a text
      editor — should not contain `<trackmap></trackmap>`)

---

## 4. Track Map editor

Open an existing track map.

- [ ] All 25 rows render
- [ ] MIDI slot fixed at bottom; can't be moved
- [ ] Type a label inline, dirty dot appears
- [ ] Drag a row to reorder
- [ ] Save / save-as / undo / history all work

---

## 5. New-X dialogs

### 5a. New Song
- [ ] Sidebar "+ New Song" button works
- [ ] Name validator catches empty / leading-dot / slash / collision
- [ ] Source folder picker works
- [ ] Create produces the folder + .jcs + sidecar (if source folder
      chosen) and opens the editor

### 5b. New Playlist
- [ ] Track Map dropdown pre-selects the first available
- [ ] Name validator catches collisions
- [ ] Create produces the .jcp under `bm_media/bm_sources/` and opens
      the editor

### 5c. New Track Map
- [ ] Template radio buttons render (Empty / Stems / Brigades style /
      etc.)
- [ ] Selected template's preview matches the resulting labels
- [ ] Create produces the .jcm and opens the editor

---

## 6. MIDI cleaning end-to-end

The high-stakes path. With Settings → MIDI → "Auto-clean imported MIDI
files" toggled **on**:

### 6a. Drag-from-source workflow
- [ ] Pick a source folder containing a "dirty" MIDI file (one with
      markers, key sigs, etc. — exported from Logic with annotations)
- [ ] Source Folder tab shows it with the **Not clean** tag
- [ ] Drag the file onto the MIDI slot in the channel grid
- [ ] Save the song
- [ ] After save, the channel-grid MIDI row shows the **Clean** badge
- [ ] Song Folder tab also shows the file with **Clean** tag (no stale
      "Not clean" left over)
- [ ] Source Folder tab still shows the original as **Not clean**
      (we never modify source files)

### 6b. Manual badge-click clean
- [ ] On a song with a dirty MIDI in its folder, the channel-grid
      shows the amber **Not clean** pill
- [ ] Clicking the pill shows the confirm dialog explaining the action
- [ ] **Cancel** does nothing
- [ ] **Clean** runs the cleaner; pill flips to green **Clean**
- [ ] Song Folder tab also reflects the change

### 6c. Toggle off behavior
- [ ] Turn the Settings toggle **off**
- [ ] Drag a dirty MIDI from source → save → file remains **Not
      clean** (auto-clean did not fire)
- [ ] Manual badge click still works

---

## 7. USB export

### 7a. Validation
- [ ] Click Export to USB with no USB stick inserted → shows clear
      error / no destinations
- [ ] Insert a USB stick → it appears in the destination list
- [ ] Pre-export validation reports any missing-reference issues

### 7b. Copy
- [ ] Confirm export → progress bar runs
- [ ] All `bm_media/` contents land on the USB stick
- [ ] `dot_clean -m` runs after the copy (no `._<file>` AppleDouble
      siblings on the stick — verify by switching the stick to the
      BandMate or by `ls -la` in Terminal)
- [ ] Eject succeeds; stick disappears from Finder

---

## 8. Differential test vs BM Loader (codec parity in the wild)

The Phase 1 codec parity audit (`docs/CODEC-PARITY-AUDIT.md`) verified
our writers against the decompiled BM Loader source. This step is the
empirical version: build the SAME song / playlist / track map in both
apps and diff the working-folder output byte-for-byte.

Catches anything the static audit missed: real-world line endings,
element ordering, number formatting, indent characters, folder
structure, file naming, unexpected sidecars, etc. Hypothesis: the
two outputs should be byte-identical except for the documented
Studio-only sidecars and any MIDI files Studio auto-cleaned.

### 8a. Setup — build the same content in both apps

Use a SEPARATE working folder per app so the outputs don't collide.

**Studio-side prep:**
- [ ] Settings → MIDI → **Auto-clean off** (so MIDI copies are
      byte-identical to source; we test cleaning separately in §6)

**Common content** (build in both apps):
- [ ] Track map: `Diff_Test_TM` with the first 5 audio channels
      labeled "L", "R", "Click", "Guitar", "Vocals" — rest empty,
      plus "Kemper" in the MIDI slot
- [ ] Song A: `Diff_Test_A` @ 48 kHz with:
      - 3 WAVs on channels 1, 2, 5 (use mono 48k WAVs from any
        existing song; copy them to a fresh source folder so both
        apps pull from the same files)
      - 1 MIDI on the MIDI slot (use a clean MIDI to keep the test
        clean — e.g. the `kemper_writing-on-the-wall_v2-bankinfo.mid`
        we already cleaned)
- [ ] Song B: `Diff_Test_B` @ 48 kHz with 1 WAV on channel 1
- [ ] Playlist: `Diff_Test_PL` referencing the track map + both
      songs in A → B order

### 8b. Diff

Once both apps have written their working folders, point me at the
two paths and I'll run a structured diff:

- Tree: same files at same relative paths? (sidecars excluded —
  Studio-side `.bandmate-studio.json` is expected and Studio-only)
- `.jcs` × 2: byte-identical?
- `.jcp` × 1: byte-identical?
- `.jcm` × 1: byte-identical?
- WAVs: identical (md5 match)?
- MIDI: identical (since auto-clean is off)?

Findings classified as:
- **OK** — match
- **Expected delta** — known Studio-only artifact (sidecars)
- **Unexpected delta** — needs investigation; new audit finding

Pass criterion: every delta falls into OK or Expected.

### 8c. Tell me you're ready

When the two folders exist, send me their absolute paths and I'll
produce the diff report.

---

## 9. BandMate device validation (the load-bearing test)

The point of all the above is THIS works.

### 9a. Mount and read
- [ ] Insert the exported USB stick into the BandMate
- [ ] Playlist menu shows all expected playlists (no `._foo.jcp`
      siblings — confirms dot_clean did its job)
- [ ] Each playlist's song list matches what BandMate Studio exported

### 9b. Playback — clean MIDI song
- [ ] Pick a song whose MIDI was auto-cleaned by Studio
- [ ] Press play — audio starts, MIDI events fire on schedule
- [ ] Kemper changes patches at the right moments
- [ ] **No spurious patch changes** (the whole reason for the cleaning
      feature). Pre-cleaning, dirty MIDI files would land the Kemper
      on wrong patches at song start or after `end_of_track` events.

### 9c. Auto-advance
- [ ] Play a 2-song playlist where song B has mid-song program
      changes
- [ ] On auto-advance from A to B, the t=0 PC fires correctly AND the
      mid-song PCs fire at their scripted times (not bunched at the
      start). This validates the v0.0.20 firmware fix is in place.

### 9d. Manual song select
- [ ] After auto-advance test, manually pick song B from the menu
- [ ] All program changes still fire at the right times

---

## Findings

### F-4: Studio doesn't seed `default_tm.jcm` / `stems_tm.jcm` on folder init
**Section:** 8 (diff)
**Severity:** minor — parity gap, not a correctness bug
**Repro:** Create a fresh empty working folder and point both apps at it. Create a single trackmap with each.
**Expected:** Both apps produce the same `bm_trackmaps/` contents.
**Actual:** Loader writes `default_tm.jcm` + `stems_tm.jcm` (stock templates) alongside the user's trackmap. Studio writes only the user's trackmap.
**Notes:** BandMate-side hardware presumably falls back to these templates if a referenced trackmap is missing — needs verification. Either way, parity with Loader means we should write them on `init_working_folder`. The templates are already known: `src/codec/index.ts`'s `createEmptyTrackMap` (default) and the Stems template, accessible from `NewTrackMapDialog`.
**Fix:** Rust `init_working_folder` now seeds `default_tm.jcm` and `stems_tm.jcm` byte-for-byte from the codec fixtures (via `include_bytes!`) when they don't already exist. Idempotent — existing user-modified copies are never overwritten.

Additional changes shipped alongside this fix (per Eric's UX feedback):
  - Template content for "Default" and "Stems" in NewTrackMapDialog now matches BM Loader's bundled `default_tm.jcm` / `stems_tm.jcm` semantically (Click/Hihat/Kick/… and Click/Stem1L/Stem1R/…).
  - "Brigades-style" template renamed to "Modern Playback" (same content, generalized label).
  - Name field placeholder is now "Name your track map…" instead of `brigades_tm`.
  - User-typed names automatically get `_tm` appended if absent (case-insensitive check) to match BandMate convention. The dialog shows a "File will be saved as <name>_tm.jcm" hint as the user types.
**Fixed in:** _(this branch; commit pending)_

### F-3: Track-map line endings differ from Loader output
**Section:** 8 (diff)
**Severity:** minor — both apps' readers accept either, no functional impact
**Repro:** Create a trackmap in each app and byte-diff the `.jcm` files.
**Expected:** Same line-ending convention.
**Actual:**
  - Loader writes **LF** line endings with a **trailing newline** (`...Kemper\n`)
  - Studio writes **CRLF** line endings with **no trailing newline** (`...Kemper`)
**Notes:** Our codec audit thought CRLF-no-trailing-newline was "stock JoeCo format" based on the `default_tm.jcm` / `stems_tm.jcm` fixtures. Modern Loader writes the opposite convention. The fixtures are BM Loader's BUNDLED templates (older convention); user-created trackmaps go through Loader's writer (newer LF + trailing newline convention).
**Fix:** `writeTrackMap` now emits LF + trailing newline. The bundled fixtures stay as-is (Studio's `init_working_folder` seeds them byte-for-byte via `include_bytes!`, so they remain CRLF on disk to match what BM Loader users see in their working folder). The dual convention is documented in the new `jcm.ts` header comment.
**Fixed in:** _(this branch; commit pending)_

### F-2: Song `<length>` ignores MIDI file duration
**Section:** 8 (diff)
**Severity:** **major** — can cut off the song before the last MIDI event fires
**Repro:** Build a song in each app with one MIDI file that is longer than every WAV in the song. Diff the `.jcs`.
**Expected:** Both apps write the same `<length>`.
**Actual:** Loader writes `<length>` = max(WAV durations, MIDI duration) × sample_rate. Studio writes max(WAV durations) only.
**Concrete numbers** from this test:
  - Longest WAV (`Ref L_golden-glove-v2.wav`) header reports 174.763s = 8388608 samples (the value Studio wrote).
  - MIDI file (`kemper_golden-glove v3.mid`) is 176.087s = 8452175 samples (the value Loader wrote).
**Why it matters:** BandMate uses `<length>` to decide when the song ends and auto-advance fires. Under-reporting means the playback engine could stop before the final MIDI program change reaches the Kemper.
**Root cause:** `SongEditor.performSave` skips `kind !== "wav"` when computing `maxSamples`. MIDI duration isn't computed by `list_audio_files` at all today.
**Fix:** New `midi::duration_seconds` function in Rust walks the SMF events + tempo map (handles `set_tempo` mid-file; falls back to 120 BPM if no tempo set; supports SMPTE timing for completeness). `list_audio_files` populates a new top-level `duration_seconds: Option<f64>` on `AudioFileInfo` for both WAV (copied from `wav_info`) and MIDI (computed). `SongEditor.performSave` and `performSaveAs` now consider both kinds in the max-duration calc, converting seconds → samples via the song's sample rate.
**Fixed in:** _(this branch; commit pending)_

### F-1: Track-map display strips `_tm` suffix from filename
**Section:** 8a (setup — caught while building the diff-test trackmap)
**Severity:** minor (UX), no data corruption
**Repro:** Create a track map named `Diff_Test_TM` in BM Studio.
**Expected:** UI shows `Diff_Test_TM` to match the filename on disk
(`Diff_Test_TM.jcm`).
**Actual:** UI shows `Diff_Test` in both the sidebar and the editor
header. Hover tooltip correctly shows the full filename.
**Root cause:** Both `TrackMapEditor.trackMapName` and `Sidebar`'s
track-map row label used the regex `/_tm\.jcm$|\.jcm$/i`, which
greedily strips a `_tm` suffix in addition to the `.jcm` extension.
The intent was to clean up BandMate's convention of naming
track-map files `<name>_tm.jcm`, but it eats intentional `_TM`
user input and creates UI ↔ filename divergence.
**Fix (initial):** Stripped only `.jcm`, leaving `_tm` in the UI.
Files like `erictest_tm.jcm` rendered as `erictest_tm`.

**Follow-up (after F-4 shipped auto-append):** Restored the
`_tm.jcm` strip in both `TrackMapEditor` and `Sidebar`. Safe to
strip again because Studio now guarantees the `_tm` suffix is
system-added — `NewTrackMapDialog` auto-appends it on create, so
it's never user-typed content. UI shows the clean name; the full
filename stays available via the row's hover tooltip. F-1's
original concern (eating user intent) no longer applies.
**Fixed in:** _(this branch; commit pending)_

---

Add new findings here as you go. Format:

```
### F-N: <short title>
**Section:** <e.g. 6a>
**Severity:** blocker / major / minor / cosmetic
**Repro:** ...
**Expected:** ...
**Actual:** ...
**Notes:** ...
```

Once a finding is fixed, leave it here and append `**Fixed in:** <commit/PR>`.
