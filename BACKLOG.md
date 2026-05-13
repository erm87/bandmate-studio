# BandMate Studio — backlog

Running list of polish / refinement / feature ideas captured outside the release-level roadmap. Release-level goals live in [docs/ROADMAP.md](docs/ROADMAP.md); this file is the working list of items waiting to be picked up.

Items tagged **[Beta blocker]** in their heading must ship before flipping `APP_PHASE` to `"beta"` (see [docs/ROADMAP.md § Beta criteria](docs/ROADMAP.md#criteria)).

Newest entries on top.

---

## [Beta blocker] In-app feedback — pre-filled GitHub Issues URL

**Where:** New "Send feedback…" affordance, probably in the working-folder bar's gear menu OR a button in Settings → About. Implementation lives wherever's most discoverable to a user who just hit a bug.

**Idea:** Build a small handler that constructs a GitHub Issues URL with the app's context pre-populated, then opens it in the user's browser via Tauri's shell plugin. The user authenticates with their own GitHub account in the browser and submits the issue. No service-side secrets, no auth flow inside BMS.

**URL shape:**
```
https://github.com/erm87/bandmate-studio/issues/new
  ?title=<encoded title>
  &body=<encoded body with version / OS / context preloaded>
  &labels=feedback
```

**Body template (auto-populated):**
- App version (`getVersion()`).
- App phase (`APP_PHASE`).
- OS + arch (from `@tauri-apps/plugin-os` or similar).
- Working folder path (if one is set) — opt-in, since the path can be personally-identifying.
- A blank section for the user to describe what happened + what they expected.

**Why this approach over alternatives:**
- A bundled GitHub API token would have to ship in the binary — easily extractable, gets revoked, anyone-can-spam.
- A proxy service we host is overkill for current scale.
- Pre-filled URL approach is zero-infra, gives the issue the user's real GitHub identity (useful for follow-up), and works the moment a user clicks.

**Implementation notes:**
- `@tauri-apps/plugin-shell`'s `open()` opens URLs in the user's default browser. Already a dep we use elsewhere (or trivial to add).
- Confirm the URL length stays under the limit `tauri.shell.open` enforces and what most browsers accept (~2k chars is safe). Body content needs `encodeURIComponent`.
- Light dialog UX: a small confirm explaining "this opens GitHub in your browser to submit feedback. Some app context will be pre-filled — review before submitting." Then a button that triggers the open.

**Captured:** 2026-05-13. Beta criterion 5 in [docs/ROADMAP.md](docs/ROADMAP.md).

---

## [Beta blocker] Working folder backwards-compatibility audit + tests

**Status:** Test plan + tooling shipped 2026-05-13. The audit run itself is the remaining step — requires Eric to have BM Loader + a substantive working folder side-by-side, runs through the 5 phases in [docs/COMPAT-TEST.md](docs/COMPAT-TEST.md). This entry stays open until the audit completes and any regressions are addressed.

**Where:** Audit protocol lives in [docs/COMPAT-TEST.md](docs/COMPAT-TEST.md). Supporting tools: `scripts/snapshot-working-folder.sh` (captures tree + sha256 hashes) and `scripts/diff-snapshots.sh` (compares two snapshots, surfaces added / removed / changed files). Code touches in the codec + USB-export paths only if the audit surfaces regressions.

**Idea:** Run an explicit round-trip test pass between BMS and BM Loader to verify the four sub-criteria from [docs/ROADMAP.md § Beta criterion 1](docs/ROADMAP.md#criteria) all hold:

- (a) **Read:** BMS can open and edit a working folder created by BM Loader without breaking anything.
- (b) **Write:** BMS-edited files can be re-opened in BM Loader and behave identically.
- (c) **Coexistence:** Alternating between BMS and BM Loader on the same working folder over multiple sessions doesn't pile up artifacts or diverge state.
- (d) **Byte-level parity** on the deterministic portions of `.jcs` / `.jcp` / `.jcm` outputs.

**Likely outcome:** mostly clean — we audited codec parity in task #1 of the project and fixed F-2 through F-8 (length / line-endings / templates / sample-rate seeding / sidecar filtering). This task is to **verify** the audit's conclusions hold for an explicit round-trip rather than just the codec layer in isolation.

**If issues surface:** open targeted GitHub Issues per regression, fix before promoting to Beta. The "Known acceptable diffs" section of COMPAT-TEST.md captures expected formatting differences (`.jcm` line endings, `<length>` recomputation post-F-2) so we don't false-positive those.

**Captured:** 2026-05-13. Beta criterion 1 in [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Settings — toggle for Smart Mapping on import

**Where:** Settings dialog → **Defaults** section (`SettingsDialog.tsx`). `userPrefs` in `persistence.ts`. Read by `SongEditor.tsx`'s `handleImportAll` and by the new auto-update dialog (next entry).

**Idea:** Add a toggle: **"Smart Mapping when importing from Source Folder"**. When on (default): the existing Import-all flow runs `bestChannelForFilename` against each candidate WAV and assigns matches to channels. When off: imports copy files into the Song Folder unassigned — no fuzzy matching, no auto-update dialog, no channel assignment writes. The user does the mapping by hand.

**Why:** Smart Mapping is great when the band's filenames stay in lockstep with track-map labels, but it's a footgun for users with idiosyncratic naming where the fuzzy matcher guesses wrong often enough to be net-negative. A single switch lets each user choose whether Smart Mapping is a feature or out of the way.

**Implementation notes:**
- New field on `userPrefs`: `smartMappingEnabled: boolean`, default `true` (preserves current behavior for existing users).
- Single source of truth — both the basic Smart Mapping path *and* the new auto-update-existing-channels behavior (next entry) gate on this same flag. When off, the auto-update dialog never appears.
- Surface in Settings as a labeled toggle with a short helper description summarizing what it does, since "Smart Mapping" alone won't be self-evident to a returning user.

**Captured:** 2026-05-11

---

## Smart Mapping — auto-update existing channel assignments on re-import

**Where:** `SongEditor.tsx` → `handleImportAll` (currently around line 1014). Today the fuzzy matcher (`bestChannelForFilename` in `lib/sourceMatch.ts`) **only assigns to empty channels** — the in-code comment explicitly says "existing assignments are never overwritten." This entry extends that path to *propose* replacements for already-populated channels, gated by user confirmation.

**Idea:** When the user runs Import all and a new candidate from the Source Folder scores a fuzzy match for a channel that already has a file, queue that as a **proposed replacement** rather than silently skipping. Show a confirmation dialog listing each proposed replacement so the user decides what gets updated.

**Dialog behavior:**
- One row per proposed replacement, showing **channel label**, **current file**, **proposed new file**, and a checkbox at the left. All checkboxes initially **checked**.
- A **Select all / Deselect all** affordance at the top of the list for bulk action.
- Footer buttons:
  - **"Confirm"** — applies only the checked replacements (plus any pure new-channel assignments and direct-copies from the existing flow). Unchecked items still copy into the Song Folder unassigned, same as the unmatched-file path today, so nothing the user picked up gets dropped.
  - **"Import without auto-mapping"** — copies all candidate files into the Song Folder but applies **no** channel assignments at all (not even the empty-channel ones the current flow would auto-fill). Equivalent to running Import all with Smart Mapping flipped off for this single import.
- Dialog is **only shown when at least one replacement is being proposed**. If Smart Mapping only finds matches for empty channels (the common case today), the import runs through with no dialog — preserves the friction-free behavior for first imports of a song.

**Heuristic for "this is a replacement candidate":**
- The new file must fuzzy-match the channel's label *better than or equal to* a defined threshold (reuse `bestChannelForFilename`'s score; require score ≥ some floor to avoid surfacing noisy near-matches as proposed replacements).
- The new file's filename must be different from the channel's current filename (otherwise it's not a replacement, just the same file).
- Tie-breaker if multiple new files claim the same channel: highest score wins, others fall into unassigned. Same tie-break rule the current flow uses for empty channels.

**Gating:**
- Whole feature gates on `userPrefs.smartMappingEnabled` from the previous entry. When off: no fuzzy matching at all, no dialog, files just copy into the Song Folder.
- When the dialog is shown and the user clicks "Import without auto-mapping," that's a one-time override — the Settings preference is not changed.

**Open questions:**
- Should the channel-empty case ALSO surface in the dialog (alongside replacements) for consistency, with its checkboxes also defaulting to checked? Probably yes — same UX, single review step before any auto-assignment lands, easier to teach. But it changes the trigger rule to "show the dialog whenever Smart Mapping wants to assign anything," which is more friction on first imports. Worth testing both.
- Behavior when a replacement is unchecked: should the *new* file still be copied to the Song Folder (just unassigned), or skipped entirely? Default to "copy in, leave unassigned" — same as the unmatched-file path today, so the user can still click-assign it manually if they reconsider.
- Where do the song's *pending dirty* edits go? Auto-update replacements should land via `applyEdit` so they show in the undo stack and the editor goes dirty + Save-required, same as manual assignments. Don't bypass the edit machinery.
- This pairs naturally with the "show what changed" entry below — together they cover Smart Mapping *and* let the user audit what it did before saving.

**Captured:** 2026-05-11

---

## Song editor — per-row change indicators

**Where:** `SongEditor.tsx` channel-grid rows. Today the only "you have changes" affordance is the blue dot badge on the Save button / song header that lights up when `editor.current` differs from `editor.baseline`. Once the user clicks Save, all change state is reset.

**Idea:** Add a per-row change indicator that helps the user audit *what specifically* has changed since last save — useful both for hand-edits and (especially) after Smart Mapping has auto-assigned things.

**Visual:**
- A small **blue dot** to the left of the file column on any channel whose file assignment has changed since the last-saved baseline. Mirror the positioning convention already used for the longest-length stopwatch icon on the same row.
- On hover, a tooltip describes the delta in plain text:
  - **Replaced:** `"File_A.wav → File_B.wav"`
  - **Newly assigned:** `"Unassigned → File_A.wav"`
  - **Cleared:** `"File_A.wav → Unassigned"`
- The dot disappears on the next successful Save (i.e. the diff is relative to the current saved baseline, not to "ever").

**Why:** Without this, a user who runs Smart Mapping has no easy way to verify *which* channels Smart Mapping touched short of scanning the whole 25-row grid against memory. Especially valuable for the auto-update-existing-channels path (above) where the change is destructive of prior state — even if the user confirmed the dialog, having a permanent in-grid record until Save lets them catch a misclick. Also useful for plain manual edits — Save's all-or-nothing dot doesn't tell you whether you changed one row or twelve.

**Implementation notes:**
- Source of truth: diff `editor.current.song.channels[i]` against `editor.baseline.song.channels[i]`. The reducer already keeps both, so this is a pure derived value.
- One badge component, three message variants based on `(baseline filename, current filename)`:
  - both set, different → "old → new"
  - baseline empty, current set → "Unassigned → new"
  - baseline set, current empty → "old → Unassigned"
  - both empty → no badge
  - both equal → no badge
- Tooltip uses the same hover affordance pattern as the longest-length stopwatch.
- Don't recompute on every render — `useMemo` the diff against baseline so it's stable across keystrokes elsewhere.
- This pairs with the auto-update dialog (above) but is standalone-valuable; ship them in either order.

**Open questions:**
- Should the dot also reflect non-file changes on the row (LVL, PAN edits)? Probably yes for consistency — anything that's not in the baseline gets the dot, and the tooltip lists all changes. But scope-creeps the change-detection logic. Start with file changes only; extend later.
- Color: use brand-blue (matching the Save-dirty dot) so the user reads "this dot is the same kind of dirty signal as the Save dot, just zoomed in." Alternatively use amber/orange to distinguish "this row changed" from "Save needed." Brand-blue is more honest about the relationship.
- Should this also appear in the Track Map editor and Playlist editor for parity? Both have the same baseline-vs-current undo machinery — would be a natural extension once the Song editor version is settled.

**Captured:** 2026-05-11

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

