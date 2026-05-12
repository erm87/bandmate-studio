# BandMate Studio — backlog

Running list of polish/refinement ideas captured outside the active phase plan. Move items into MVP-PLAN.md (or a follow-up plan) when we're ready to act on them.

Newest entries on top.

---

## Source Folder tab — manual refresh button

**Where:** `SourceFilesPane.tsx` — `SourceFolderHeaderActions` (the Import all / Clear / Change… row).

**Idea:** Add a small tertiary "Refresh" button alongside Clear / Change… that re-runs `listAudioFiles(sourceFolder)` against the existing source folder. Today the only ways to pick up newly-exported files (e.g., a fresh Logic bounce dropped into the source folder mid-session) are to Clear + re-Change to the same folder, or restart the app. Either is friction.

**Why:** This is the most-common live workflow — open BMS, pick the Logic export folder once, then iterate on bounces in Logic. The user shouldn't have to round-trip through the folder picker just to see what they just exported.

**Implementation notes:**
- Re-uses the existing refresh primitive: `FolderView` already accepts a `refreshKey` prop that bumps re-list when incremented. The Song Folder tab uses this for post-save / post-clean refresh (`songFolderRefreshKey` in `SongEditor`). Add a sibling counter for the source-folder tab.
- Or simpler: lift `FolderView`'s `refreshKey` to `SourceFilesPane` for the source tab too, and the new button bumps it directly.
- The module-level `folderListCache` in `SourceFilesPane.tsx` is refreshed automatically by the existing fetch path — no special invalidation needed.
- Button style: tertiary xs (matches Clear / Change… chrome). Refresh-arrow icon — `WorkingFolderBar.tsx`'s working-folder refresh IconButton has a usable glyph already; lift it into a shared icon module if reused.
- Bonus: also bump `sourceFolderFiles` state in `SourceFilesPane` so the Import all button's disabled state updates correctly after refresh (the `onFilesLoaded` callback already wires this — it'll fire on the bumped re-list).

**UX note:** consider whether to ALSO auto-refresh on window focus. A "user just came back from Logic, files appeared" workflow could be served without a button at all by listening for `visibilitychange` / `focus` and revalidating in the background. The button is the discoverable mechanism; window-focus auto-refresh is the polish layer on top. Probably ship the button first.

**Captured:** 2026-05-13

---

## Editor pane — structural refactor (if View Transitions alone isn't enough)

**Status (2026-05-12):** the View Transitions spike has shipped (see `src/lib/viewTransition.ts` + `EditorPane.tsx`'s `view-transition-name: editor-pane`). The browser now crossfades the editor pane on selection change instead of hard-cutting. This may be the whole win — only pick up this entry if VT alone still feels "popping" on async data load (the new editor mounts in a brief loading state which the crossfade captures as its "after" frame).

**Where:** `EditorPane.tsx`. Currently still uses `<SongEditor key={sel.jcsPath} ...>` etc. to force unmount/remount on every selection change. The crossfade smooths the visual cut but the underlying unmount/remount + async data load are still happening.

**Idea:** Restructure so that the shared chrome (header strip, channel grid scaffold, side panels) stays mounted across selection changes, and only the data inside swaps. Paired with the existing VT layer, gives a true content-to-content morph with no empty-loading-state pop.

**Strategies (do in order):**
1. **Drop the `key` prop, lift data fetching out of the editor.** Move the per-selection load into a hook in `EditorPane` (or one level up) that takes `sel` and returns the parsed model. Editors become controlled components that re-render with new props instead of unmounting.
2. **Stable shared layout component.** Introduce `<EditorShell>` that owns the header strip + grid skeleton + right-rail slot. Each editor renders *into* it via children/slots. When selection changes, `<EditorShell>` stays mounted; only slot content swaps.
3. **Suspense + `useDeferredValue(selection)`** so the previous editor stays visible until the new selection's data is ready. Combined with VT, gives no flash of empty content.
4. **Skeleton placeholders** inside the editor body as a safety net for slow loads (>100ms).

**Order of operations when picking this up:**
1. Audit each editor's mount-time effects — anything that *relied* on remount semantics (one-shot effects, focus restoration, scroll resets, baseline snapshots in undo stacks) needs to move to an explicit `useEffect([sel])`. The current `key`-based remount is hiding some "happens on selection change" logic that needs to surface deliberately.
2. Extract `<EditorShell>` shared chrome.
3. Lift data loading; remove the `key` prop.
4. Manual QA pass: switch rapidly between every combination of song ↔ playlist ↔ trackMap with and without unsaved changes; confirm the unsaved-changes guard still fires correctly (it currently hangs off the selection-change path in `requestSelect`).

**Captured:** 2026-05-11 (original entry); 2026-05-12 (rewritten after VT spike shipped).

---

## Button variant cleanup — extract a reusable Button component with primary/tonal/tertiary tiers

**Where:** Currently ad-hoc Tailwind classes per button across the app. Notable instances: editor-header Save buttons, dialog confirms, Export to USB (now tonal), Change working folder, refresh/gear icon buttons, sidebar "+ New X" affordances, dialog action buttons.

**Idea:** Pull the three implicit tiers — **primary**, **tonal**, **tertiary** (outlined/ghost) — into a single `<Button variant="primary|tonal|tertiary">` component with shared sizing, focus-ring, and disabled-state handling. Migrate existing call sites incrementally.

**Why:** Now that all three tiers are in use (primary for Save / dialog confirm, tonal for Export to USB, tertiary outlined for Change + ghost icon buttons), every site is recomputing the same long Tailwind string. A typo or drift in any one of them creates a subtle inconsistency. Centralizing is just hygiene at this point.

**Tier definitions to encode:**
- **Primary:** `bg-brand-500 text-white hover:bg-brand-600` — reserved for the active in-context primary action.
- **Tonal:** `bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-900/40` — persistent / global actions.
- **Tertiary:** `border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900` — neutral / "Change", outlined.

All three share: rounded-md, px-3 py-1.5, text-sm font-medium, transition, focus-visible accent ring + offset, disabled:opacity-50.

**Open questions:**
- Danger variant (red destructive)? Not currently used, but Delete actions in the sidebar context menu are close. Worth defining ahead of time so it's one tier among four rather than a bolt-on later.
- Size variants (xs, sm, md)? Header buttons are slightly chunkier than dialog buttons today. Either standardize on one size or expose `size` as a prop.

**Captured:** 2026-05-12

---

## USB export — skip files not referenced by any song

**Where:** Settings (new "Export" section or extend "Defaults") + `export_to_usb` Rust command.

**Idea:** A toggle that limits the bm_media → USB copy to only the audio/MIDI files actually referenced by at least one song's `.jcs`. Saves space + time on USB writes when song folders accumulate unused takes from earlier Logic exports.

**Why:** Source folders inside `bm_media/<song>/` can grow over time as renders are replaced. Currently we copy everything verbatim, which means unused stems still take up space on the BandMate stick. With this on, the working folder stays as the user's archive; the USB stick gets only what BandMate actually needs to play.

**Default:** off. The live-rig reliability principle says we don't change export semantics by default — full-copy stays the safe baseline.

**Implementation notes:**
- `userPref: exportOnlyReferencedFiles: boolean` in `persistence.ts`.
- Reference resolution lives TS-side: walk the scan, parse each `.jcs`, build the keep-list from `<file><filename>` and `<midi_file><filename>`, pass to Rust `export_to_usb` as an explicit include-list. The codec is already in TypeScript — no need to port to Rust.
- The `.jcs` itself always ships, regardless of whether its referenced files exist on disk.
- `bm_sources/*.jcp` and `bm_trackmaps/*.jcm` always ship — they're not under song folders.
- `.bandmate-studio.json` sidecars stay excluded (Studio-only; verify in current export code).
- Filename compare must be **case-insensitive** on macOS — APFS is case-insensitive by default, so the `.jcs` could legitimately say `drum.wav` while the file on disk is `Drum.wav`.

**Pre-export validation extension:** existing validation already flags missing references. Add a summary line: "Skipping N unused file(s) (~M MB)". Surface a warning if turning the toggle on results in zero files being copied for a song (probably a parse error).

**Validation step for `docs/SMOKE-TEST.md`:** once shipped, add an "export with toggle on" scenario. Verify file counts on the USB stick and confirm all songs still play correctly on the actual BandMate with the trimmed set.

**Captured:** 2026-05-11 (from in-session task #17, this conversation)

---

