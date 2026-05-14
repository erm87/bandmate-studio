# USB-export parity test plan

> **Last run (2026-05-14, macOS): PASS** via the pretend-USB short form — BMS exported to a local destination folder; snapshot of the destination's `bm_media/` was byte-identical to the source working folder's `bm_media/` modulo the documented `.bandmate-studio.json` sidecar strip (48 → 44 files, 4 sidecars removed, zero content drift). Tree of test working folder spanned 14 song folders, 2 playlists, 1 custom track map. Snapshots kept under the gitignored `audit-runs/snapshots/` for reference.
>
> **Windows half: pending** [Beta criterion 4](ROADMAP.md#criteria) ("Windows build validated") — can't run until BMS launches on Windows.
>
> **Belt-and-suspenders (full BM-Loader-driven audit): not yet run.** The pretend-USB short form treats the working folder as the BM-Loader baseline (since BM Loader uploads the working folder verbatim per [SPEC.md](../SPEC.md)). If anything ever feels off in BM-Loader-vs-BMS USB output, run the full audit below.

Verifies that BandMate Studio's **Export to USB** produces the same on-disk tree as BM Loader's USB upload for the same working folder, on both macOS and Windows. This is the manual audit that closes [Beta criterion 2](ROADMAP.md#criteria) — "USB Export output matches BM Loader on both macOS and Windows" — and unblocks the alpha → beta phase flip.

Re-run this whenever the USB export pipeline (the Rust `export_to_usb` command, the `is_export_excluded` filter rules, the include-filter logic, or `run_dot_clean`) changes in ways that could affect the output tree.

## How this relates to Criterion #1

[Criterion #1](ROADMAP.md#criteria) already verifies byte-level parity for `.jcs` / `.jcp` / `.jcm` *inside the working folder* — see [COMPAT-TEST.md](COMPAT-TEST.md). USB export ships those same files verbatim from the working folder, plus the WAV / MIDI media (raw `fs::copy`, byte-identical to the source). So Criterion #2's surface area is narrow:

- **What's already covered by #1**: byte content of `.jcs` / `.jcp` / `.jcm` files.
- **What this audit verifies**: the *transfer* — same file set, same paths, same exclusions on each side. Plus the parts of the pipeline that only run at export time (`is_export_excluded`, `run_dot_clean`).

If #1 passes for a given working folder, this audit's diff should reduce to "any file present in one tree but not the other, or any file with content drift introduced by the copy/cleanup step."

## Preconditions

- BM Loader installed and runnable on each test machine (one macOS, one Windows).
- A BandMate-formatted USB stick. Easiest if it's empty / freshly formatted on each phase so the diff isn't polluted by stale content. (BandMate sticks are typically FAT32 / exFAT; reformat if unsure.)
- A reasonably-complete working folder — the same one used in [COMPAT-TEST.md](COMPAT-TEST.md) is ideal so the audit substrate is consistent. The working folder **must not be edited between the two export phases** or the diff is meaningless.
- BMS built (`pnpm tauri build`) or running in dev (`pnpm tauri dev`).
- `scripts/snapshot-working-folder.sh` and `scripts/diff-snapshots.sh` available (already in this repo). On Windows, run them under **Git Bash** or **WSL** — Git for Windows ships Git Bash and provides `bash`, `find`, `shasum`, `sort`, `xargs`, which is everything the scripts need.

### Windows-specific pre-req

The Windows half of this audit can't run until [Beta criterion 4](ROADMAP.md#criteria) ("Windows build validated") is at least at the "BMS builds and launches on Windows" stage. The macOS half can proceed independently. Mark the macOS run PASS first, then complete the Windows run after #4 has a working build.

## Phases

The audit runs once per OS. Each pass walks Phases A–D in order; Phase E is a thin hardware sanity-check that overlaps with [Beta criterion 3](ROADMAP.md#criteria) (full hardware validation lives there).

### Phase A — Baseline export from BM Loader

1. Wipe the USB stick (or use a freshly-formatted one).
2. Open BM Loader, point it at the test working folder.
3. Run BM Loader's USB upload action → the test stick. Wait for it to finish.
4. Snapshot the stick's `bm_media/` tree:

   ```bash
   scripts/snapshot-working-folder.sh /Volumes/<USB-NAME> loader-export-<os>
   ```

   On Windows under Git Bash, the path is `/<drive-letter>/`, e.g. `/d/`.

Produces `loader-export-<os>/` with `tree.txt` + `hashes.txt`, filtered to exclude `.DS_Store` and `._*` (so macOS metadata noise doesn't enter the diff).

### Phase B — BMS export

1. Wipe the USB stick again (or use another freshly-formatted one). Crucial: the second export must run against an empty stick, not over the top of the BM Loader output, or the diff conflates "what BMS would have written from scratch" with "what BMS preserved from BM Loader's write."
2. Open BMS, point it at the same working folder (do not edit anything between A and B).
3. Click **Export to USB** → the same stick. Wait for the success step.
4. Snapshot:

   ```bash
   scripts/snapshot-working-folder.sh /Volumes/<USB-NAME> bms-export-<os>
   ```

### Phase C — Diff

```bash
scripts/diff-snapshots.sh loader-export-<os> bms-export-<os>
```

**Expected output**: at most, the [known acceptable diffs](#known-acceptable-diffs) below. Anything else is a regression — file as a bug with the diff output and a copy of any divergent files attached.

### Phase D — Source-stability check

Sanity-check that the working folder didn't drift between Phases A and B (otherwise the diff is meaningless).

```bash
scripts/snapshot-working-folder.sh /path/to/working-folder wf-before-audit   # before Phase A
scripts/snapshot-working-folder.sh /path/to/working-folder wf-after-audit    # after Phase B
scripts/diff-snapshots.sh wf-before-audit wf-after-audit
```

**Pass criterion**: the working folder is byte-identical between the two snapshots, modulo `.bandmate-studio.json` sidecars (which BMS may touch on song open — see [COMPAT-TEST.md § Known acceptable diffs](COMPAT-TEST.md#known-acceptable-diffs)). If the working folder drifted, redo Phase B.

### Phase E — Hardware playback (lite)

Plug the BMS-exported stick into the BandMate hardware. Confirm:

1. The BandMate boots and the expected songs / playlists appear in its UI.
2. Pick a song from each playlist and press Play. Audio + MIDI cues route correctly to the rig.

Full hardware validation is [Criterion #3](ROADMAP.md#criteria); this phase only catches "exporter produced a tree the BandMate can't read at all" — a fast smoke check, not a substitute for the full rehearsal validation.

## Known acceptable diffs

These are intentional and shouldn't be filed as regressions:

- **`.jcs` / `.jcp` / `.jcm` whitespace and line endings** — BMS's writers produce slightly different formatting from BM Loader's (notably `.jcm` line endings, `.jcs`/`.jcp` indent style). Parsed content is identical and Criterion #1 already verified this round-trips cleanly. See [COMPAT-TEST.md § Known acceptable diffs](COMPAT-TEST.md#known-acceptable-diffs).
- **`<length>` in `.jcs`** — only diverges if BMS has re-saved a song since BM Loader last wrote it (BMS includes MIDI in `<length>` derivation; BM Loader doesn't). For an audit run against a clean BM-Loader-written working folder, both exports should match here.
- **AppleDouble `._*` files** — the snapshot script filters these out. BMS's pipeline also runs `dot_clean -m` on macOS post-copy to strip them from the destination, so they shouldn't appear at all in the BMS snapshot. BM Loader may or may not strip them; the filter hides this either way.
- **`.bandmate-studio.json` sidecars** — BMS's `is_export_excluded` strips these from the export. BM Loader doesn't write them. Neither tree should contain any.
- **`.DS_Store`** — filtered by BMS export and by the snapshot script. Should not appear in either side.

If a diff falls outside these categories, file it as a regression bug.

## Reporting

Record one of the following per OS:

- **PASS (macOS)** — Phases A–D completed without unexpected diffs.
- **PASS (Windows)** — same, on Windows.
- **FAIL** with a GitHub Issues link describing the regression (specific paths, full diff output, sample files attached where relevant).

Beta criterion 2 closes when both OSes record PASS. The Windows PASS is also a partial step toward [Criterion #4](ROADMAP.md#criteria) — note that overlap in the issue/PR that closes either criterion.
