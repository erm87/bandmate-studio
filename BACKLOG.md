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

