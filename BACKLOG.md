# BandMate Studio — backlog

Running list of polish / refinement / feature ideas captured outside the release-level roadmap. Release-level goals live in [docs/ROADMAP.md](docs/ROADMAP.md); this file is the working list of items waiting to be picked up.

Items tagged **[Beta blocker]** in their heading must ship before flipping `APP_PHASE` to `"beta"` (see [docs/ROADMAP.md § Beta criteria](docs/ROADMAP.md#criteria)).

Newest entries on top.

---

## USB Export — clean up orphaned files on the destination

**Where:** `export_to_usb` in `src-tauri/src/lib.rs`. Likely a new opt-in option on the `ExportToUsbDialog` confirm step, paired with the existing "Export updates only" toggle but distinct (orphan deletion is destructive; incremental skip is not). New Tauri command if a dedicated "preview orphans" step is wanted before the destructive action.

**Idea:** An export run sees only what's in the working folder. Files that exist on the USB but no longer exist in the working folder (e.g. a song the user deleted, a playlist they renamed before re-exporting, a stale track map from a previous project) are left untouched on the USB by every existing export mode. Over time the stick accumulates orphan files — songs the band can still see in the BandMate's menu even though they're no longer part of the current set, broken playlist references pointing at deleted songs, etc. This entry covers an explicit "Clean up orphaned files on USB" feature that removes them.

**Why:** The 0.10.3 incremental-export feature stops at "don't re-copy what's unchanged." It doesn't and intentionally won't auto-delete from the destination — silent destruction violates the project's reliability principle ("no silent destruction"). But the user pain point is real: after months of edits on the same stick, the BandMate's UI shows ghost songs and the user has to manually nuke the USB and re-export from scratch to get a clean state. An opt-in, confirm-dialog-gated orphan cleanup gives the same outcome with much less friction and without forcing a multi-GB re-write.

**State machine sketch:**

1. **Detect.** Walk the destination's `bm_media/` tree. For each file under `bm_sources/<song>/`, `bm_trackmaps/*.jcm`, or `bm_media/*.jcp`, check whether a corresponding source path exists in the working folder. Categories:
   - **Orphan song folder** — destination has `bm_sources/<name>/` but the working folder doesn't.
   - **Orphan media file** — song folder exists in both, but the destination has a `.wav` / `.mid` not present in the source's song folder. (Could be a re-bounce that renamed the file.)
   - **Orphan playlist** — `<name>.jcp` on destination, missing from source.
   - **Orphan track map** — `<name>.jcm` on destination, missing from source.
   - **Stray file** — anything else under `bm_media/` not matching the above (cautious default: do NOT delete unrecognized files, list them in the preview but require an explicit override).

2. **Preview.** A modal block on the Confirm step lists what would be removed, grouped by category, with byte totals ("This will remove 3 songs, 2 track maps, and 1 playlist totaling 540 MB from the USB"). User can expand each category to see filenames. Default action is **Cancel**; explicit click on **Clean up orphans** to proceed.

3. **Confirm.** Second-level "are you sure?" given that this is destructive (`<ask>` style). Lists the volume name being modified so the user can't confuse two plugged-in sticks.

4. **Execute.** Delete files (and empty song folders) on the destination. Track per-file outcomes the same way the regular export does. Emit `export-progress`-style events so the dialog can show a progress bar.

5. **Summary.** "Removed N songs, M track maps, K playlists (X MB freed)." Lists names that were removed.

**Implementation notes:**

- **Hidden / system files exempted.** `.DS_Store`, `.bms_writable_probe`, etc. — never delete macOS-system or Studio-internal sidecar files on the USB. The existing `is_export_excluded` list is the right starting filter.
- **Stray-file conservatism.** If the user has manually placed files on the USB that aren't part of any working folder (a `notes.txt`, a backup, etc.), the feature should preview them but not delete them by default. Add a separate "Also remove unrecognized files" checkbox that defaults off.
- **Working folder identity.** The detection compares destination paths against the *current* working folder. If the user previously exported from a different working folder to the same stick, files from the previous working folder will all look like orphans. That's the correct call — the destination should mirror the working folder the user is currently exporting from — but the preview wording should make it clear ("These files aren't in your current working folder").
- **Combine vs separate flow.** Two reasonable shapes:
  - **(a) Bundled with export.** "Clean up orphans" checkbox on the confirm step; runs after the regular copy. Pros: one workflow. Cons: harder to preview the deletes vs the writes in one dialog.
  - **(b) Separate "Clean up USB" affordance.** A new button in the editor pane or USB-related submenu that opens its own dialog. Pros: clean separation between additive (export) and destructive (cleanup) operations. Cons: extra navigation surface.
  
  Lean (b) — the destructive intent earns its own surface, and users will run cleanup less often than export, so the friction is appropriate.

**Open questions:**

- **Preview before / after the copy?** If bundled with export, deletes could run before (free up space first, useful for near-full sticks) or after (only act on a successful copy). Probably after — a failed copy followed by orphan deletion could leave the stick in a worse state than where it started.
- **Should deleting an orphan song folder also delete its `bm_sources/<song>/` directory entry, or just the files inside?** Both. After deleting all files, remove the empty directory so the BandMate's menu doesn't show empty songs.
- **Recovery / undo?** Not in scope. Once a delete commits, it's gone. The confirm-dialog gate is the safety net.
- **Cross-validation with playlists.** If a playlist references songs that exist on the USB but those songs are orphans (not in the working folder), should the playlist also count as orphan, or as a "broken playlist" warning? Probably orphan — a playlist whose songs no longer exist in the working folder is itself stale.

**Phased proposal:**

1. **PR 1.** Detection + read-only preview (no delete). Opens a new "Inspect USB" dialog that shows what's on the stick that's not in the working folder. Pure information; nothing destructive. Validates the detection heuristic across real working folders before any code goes near `fs::remove_*`.
2. **PR 2.** Confirmation flow + the actual delete. Behind the explicit user click. Includes the progress + summary terminal states.
3. **PR 3 (optional).** Stray-file handling under a separate opt-in checkbox.

**Captured:** 2026-05-15 (during 0.10.3 incremental-export planning; deferred to keep the incremental PR scoped to the safe non-destructive case).

---
