# Working-folder backwards-compatibility test plan

Verifies that BandMate Studio reads, writes, and coexists cleanly with BM Loader on the same working folder. This is the manual audit that closes [Beta criterion 1](ROADMAP.md#criteria) — "Working folder backwards compatibility with BM Loader" — and unblocks the alpha → beta phase flip.

Re-run this whenever the codec, USB-export, or per-song-sidecar code paths change in ways that could affect on-disk format.

## Preconditions

- BM Loader installed and runnable on the same machine.
- A reasonably-complete working folder (BM Loader-managed) to test against. If you don't have one handy:
  - Open BM Loader.
  - Create 2-3 songs (each with 2-4 WAV files + 1 MIDI file).
  - Create 1-2 playlists referencing those songs.
  - Create 1-2 custom track maps in addition to the seeded `default_tm.jcm` / `stems_tm.jcm`.
  - That gives enough surface area to surface most bugs.
- BMS built (`pnpm tauri build`) or running in dev (`pnpm tauri dev`) — either works.
- The `scripts/snapshot-working-folder.sh` and `scripts/diff-snapshots.sh` tools available in this repo (both are checked in).

## Phases

The audit walks the four sub-criteria in order. Each phase has a pass criterion; if any phase fails, capture the regression as a GitHub issue and block the Beta promotion until it's resolved.

### Phase A — Baseline snapshot

Capture the working folder's state from BM Loader before BMS touches it.

```bash
scripts/snapshot-working-folder.sh /path/to/working-folder loader-baseline
```

Produces a `loader-baseline/` directory next to the working folder containing `tree.txt` (sorted file list) and `hashes.txt` (sha256 per file). Both are filtered to skip `.DS_Store` and `._*` AppleDouble files so macOS metadata noise doesn't show up in diffs.

### Phase B — Read parity (sub-criterion a)

Open the working folder in BMS. Verify it reads everything BM Loader produced without errors.

1. Launch BMS, pick the same working folder.
2. **Sidebar inventory**: every song / playlist / track map BM Loader wrote should appear in the sidebar.
3. **Songs**: open each song; verify channel assignments, filenames, levels, pans, and sample rate match what BM Loader showed.
4. **Playlists**: open each; verify song order and selected trackmap match BM Loader's view.
5. **Track maps**: open each; verify channel labels match.
6. **No errors**: the working-folder bar and individual editors should show no error toasts / red banners.

**Pass criterion**: all items load and display correctly; no errors anywhere. If something is missing or mis-rendered, that's a codec read regression — file a bug with the specific file that's not parsing, attach a copy.

### Phase C — Save-without-modification byte parity (sub-criterion d)

Verify BMS writes back what it read, without injecting drift.

1. In BMS, open a song, click into the editor, then click **Save** with no actual changes.
2. Repeat for one playlist and one track map.
3. Take a new snapshot:
   ```bash
   scripts/snapshot-working-folder.sh /path/to/working-folder bms-save-noop
   ```
4. Diff:
   ```bash
   scripts/diff-snapshots.sh /path/to/loader-baseline /path/to/bms-save-noop
   ```

**Expected output**:
- **Added in B**: only `.bandmate-studio.json` sidecars in the song folders BMS opened (one per song).
- **Removed**: none.
- **Content changed**: at most, the `.jcs` / `.jcp` / `.jcm` files that BMS re-saved. Open each diff and verify it's only the deterministic formatting changes BMS makes (e.g., `.jcm` files normalized to LF endings, per the codec audit). No spurious data shifts.

**Pass criterion**: no unexpected files appear, no file deletions, and content changes are confined to BMS-touched files with only the expected formatting deltas. Any other diff is a regression — file a bug with the diff output attached.

### Phase D — Write parity (sub-criterion b)

Verify BM Loader can re-open a working folder BMS has edited, and sees the edits identically.

1. In BMS, make a substantive edit to each artifact type:
   - **Song**: assign a new WAV to an empty channel, change the level on an existing channel.
   - **Playlist**: reorder one song, change the selected trackmap.
   - **Track map**: rename one channel label.
2. Save each.
3. Quit BMS.
4. Open BM Loader. Open the same working folder.
5. Verify each of the edits made in step 1 appears correctly in BM Loader's UI.
6. Check BM Loader's loading: it should not produce any warnings, errors, or weird file listings for the `.bandmate-studio.json` sidecars BMS left behind. Specifically: BM Loader's file scan should ignore them by extension (anything not `.jcs` / `.jcp` / `.jcm` should be invisible to BM Loader's song/playlist/trackmap views).

**Pass criterion**: BM Loader sees BMS's edits as if BM Loader had made them itself. No errors. No mention of `.bandmate-studio.json` files in BM Loader's UI.

### Phase E — Coexistence (sub-criterion c)

Verify alternating between the two apps doesn't accumulate artifacts or diverge state.

Run this loop 3-5 times:

1. Edit something in BMS, save.
2. Open in BM Loader, edit something else, save.

After each iteration:

```bash
scripts/snapshot-working-folder.sh /path/to/working-folder iter-N
scripts/diff-snapshots.sh /path/to/iter-(N-1) /path/to/iter-N
```

**Expected pattern**:
- File count grows monotonically only with actual user edits (new songs, new playlists). No phantom files appearing.
- Sidecars stay one-per-song-folder; no duplicates, no proliferation outside song folders.
- Each app picks up the other's edits cleanly — no "song missing" or "channel reset" surprises.

**Pass criterion**: file-count growth tracks only deliberate user changes; sidecar count = song count at all times; both apps load and display all artifacts after every iteration.

## Reporting

For each phase, record one of:
- **PASS** — phase completed without issues.
- **FAIL** with a GitHub Issues link describing the regression (specific files, repro steps, diff output where applicable).

The audit is considered complete only when all five phases (A baseline + B-E test phases) pass on a substantive working folder. At that point Beta criterion 1 is satisfied and `APP_PHASE` can flip to `"beta"` (assuming the other Beta criteria are also met).

## Known acceptable diffs

Some byte-level diffs are intentional and shouldn't be filed as regressions:

- **`.jcm` line endings**: BM Loader's seed templates use CRLF; BMS's writer normalizes to LF on user-authored / re-saved files. Documented in `src/codec/jcm.ts`. The BandMate's loader is lenient about both, so playback is identical.
- **`.jcs` / `.jcp` whitespace**: BMS's writer uses its own indentation; BM Loader's may differ. As long as the parsed content is identical (channel assignments, song order, etc.), this is fine.
- **`<length>` on save** (smoke-test finding F-2): BMS computes `<length>` from the longest media file including MIDI, where BM Loader used WAV duration only. After BMS re-saves a song, `<length>` may grow if a MIDI file is longer than every WAV — that's a deliberate fix, not a regression.

If a diff falls outside these categories, file it as a regression bug.
