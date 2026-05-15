# BandMate Studio — backlog

Running list of polish / refinement / feature ideas captured outside the release-level roadmap. Release-level goals live in [docs/ROADMAP.md](docs/ROADMAP.md); this file is the working list of items waiting to be picked up.

Items tagged **[Beta blocker]** in their heading must ship before flipping `APP_PHASE` to `"beta"` (see [docs/ROADMAP.md § Beta criteria](docs/ROADMAP.md#criteria)).

Newest entries on top.

---

## Planning-docs fast lane — bypass version bump + CHANGELOG entry for backlog / plan edits

**Where:** `scripts/check-version-sync.mjs` and `scripts/check-changelog-entry.mjs` (the CI gate scripts introduced in Phase H1 of `docs/HYGIENE-PLAN.md`). `.github/workflows/ci.yml` (no change strictly required — the scripts self-skip). New `scripts/update-planning.sh` (the one-liner workflow tool). Update to `docs/HYGIENE-PLAN.md` Phase H1 noting the exception.

**Idea:** Today every change goes through the same per-PR ceremony: branch, bump version, CHANGELOG entry, PR, CI, merge, tag. For *shippable* changes (code, user-visible docs, anything tied to the binary) that ceremony is the right discipline. For *planning surfaces* (`BACKLOG.md`, `docs/HYGIENE-PLAN.md`, `docs/CLEANUP-PLAN.md`, `docs/archive/`) the ceremony is friction without a corresponding safety benefit — these files don't ship in a release, don't affect runtime behavior, and don't need CHANGELOG entries because the user-facing record of what shipped lives in the CHANGELOG itself, not the planning artifacts.

Relax the CI version-checks for planning-only changes and add a one-liner script that handles the whole edit-to-merged cycle for backlog updates.

**Why:** Currently, capturing a single backlog entry costs ~10 minutes of process overhead (branch, two file edits, push, CI wait, merge, tag). That suppresses the very behavior the backlog exists to enable — writing things down when you notice them. The version-tag history is also accumulating bumps that don't correspond to anything shippable (0.8.4 → 0.8.10 in one stretch was mostly repo hygiene + docs); future-you reading `git tag --list` won't be able to tell which versions represent real change from which represent backlog churn. Restoring "version bump = shippable change" signal is its own win.

**Implementation notes:**

- **Single shared allowlist** as a top-of-file constant in both scripts (and in `scripts/update-planning.sh`), so adding a new planning doc only requires editing one list. Initial entries:
  ```js
  const PLANNING_PATHS = [
    "BACKLOG.md",
    "docs/HYGIENE-PLAN.md",
    "docs/CLEANUP-PLAN.md",
    "docs/archive/",  // prefix match — anything archived
  ];
  ```
- **`check-version-sync.mjs`:** keep enforcing across the four versioned files unconditionally. Version-file desync is always a real bug regardless of what triggered the PR, so this check doesn't get an exception. (Cheap to run anyway.)
- **`check-changelog-entry.mjs`:** before its existing logic runs, gather changed files (`git diff --name-only origin/main...HEAD` in CI; `git diff --name-only HEAD origin/main` for local pre-commit if Phase H5 lands). If every changed path matches an entry in `PLANNING_PATHS` (exact match for files, prefix match for `docs/archive/`-style directory entries), log `"Planning-docs-only change; skipping CHANGELOG entry check."` and exit 0.
- **Typecheck and tests still run** on every PR, including planning-only ones. They're fast (<30s for both) and the safety net is independent of whether the change is shippable. Skipping the version checks is what removes the actual friction.
- **`scripts/update-planning.sh`** — collapses the workflow to one command. Takes a commit message arg, assumes one or more planning-allowlist files have uncommitted changes, creates a timestamped branch, commits + pushes, opens a PR with `gh pr create --fill`, marks the PR `--auto`-merge so it merges as soon as CI passes (no second visit required), checks main back out and pulls. Approximate shape:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  msg="${1:-Update planning docs}"
  branch="docs/planning-$(date +%s)"
  git checkout -b "$branch"
  git add BACKLOG.md docs/HYGIENE-PLAN.md docs/CLEANUP-PLAN.md docs/archive/ 2>/dev/null || true
  git diff --cached --quiet && { echo "No planning changes staged"; exit 0; }
  git commit -m "$msg"
  git push -u origin "$branch"
  gh pr create --fill --title "$msg" --body "Planning-only change; CI version/changelog checks auto-skip."
  gh pr merge --squash --delete-branch --auto
  git checkout main && git pull
  ```
- **Refuse to fast-lane if non-planning files are staged.** The script should check the staged-files list against the allowlist and abort with a clear error if anything else slipped in (e.g., the user accidentally also edited `src/`). Guards against the user thinking they made a planning-only edit when they didn't.
- **`docs/HYGIENE-PLAN.md` Phase H1 update:** under the bullet for `check-version-sync` / `check-changelog-entry`, append: *"Both scripts skip themselves when every changed file matches an entry in the planning-docs allowlist (`BACKLOG.md`, hygiene/cleanup plans, `docs/archive/`). Planning edits don't ship a version and shouldn't be gated on version-metadata consistency. See `scripts/update-planning.sh` for the one-command workflow."*

**Ordering:** ship AFTER Phase H1 of `docs/HYGIENE-PLAN.md` lands. The CI checks the exception modifies don't exist before H1.

**Open questions:**

- **Should `CLAUDE.md` be in the fast-lane allowlist?** Lean **no.** `CLAUDE.md` is read at every Code session start and is load-bearing for contributors; changes to it are meaningfully shippable in the sense that "what Code sessions see" diverges before vs after. Keep it on the ceremony side. Same logic for `README.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, `docs/VERSIONING.md`, `docs/COMPAT-TEST.md`, `docs/EXPORT-PARITY-TEST.md`, `docs/DEV-SETUP.md`, `docs/SMOKE-TEST.md` — all docs that contributors (human or Code) read for normative information. The fast lane is for *intent capture surfaces* (backlog, planning), not *reference docs*.
- **Should typecheck/tests also skip for planning-only?** Lean **no.** They're fast (~30s combined) and they catch the case where a planning-only PR accidentally includes a code change that didn't get caught by the allowlist filter (a belt-and-suspenders check). The friction we're removing is the *version + CHANGELOG ceremony*, not all CI.
- **Manual override flag for a "this backlog entry is notable; bump anyway"?** Probably overkill — if you ever want to force a bump for a meaningful planning change, do it manually (edit the version files, add a CHANGELOG entry, skip `update-planning.sh`). The script is the optimization, not the only path.
- **Should the `update-planning.sh` workflow also support multiple commits per PR?** No. The fast lane is for one-edit-one-PR. If a planning change is big enough to warrant multiple commits, it's big enough to deserve the regular workflow.

**Captured:** 2026-05-14

---

## USB Export — progress indicator with ETA, cancel, success/error/canceled states

**Where:** `ExportToUsbDialog.tsx` (current "Start export" button + confirm UI). Rust side: `export_to_usb` command in `src-tauri/src/lib.rs` (and likely helpers it calls — check `src-tauri/src/usb.rs` or similar). New event channel from Rust → JS for progress streaming. A new `cancel_export` Tauri command for the cancellation signal.

**Idea:** The current export dialog dismisses or freezes once the user clicks **Start export**, with no feedback on what's happening. For a band copying their working folder (often 5-50 GB) to a USB stick before a show, this is the highest-stakes operation in the whole app and currently feels like the UI hung. Replace the post-click silence with a proper progress state machine: in-progress UI with bytes-based progress bar + ETA + current file + cancel button, followed by an explicit Success / Error / Canceled terminal state.

**Why:** USB writes take real time (consumer sticks at 20-100 MB/s; 10-min exports aren't unusual). Without feedback the user can't distinguish "running normally" from "stuck"; some will assume the worst and kill the app mid-write, which is the actual recipe for corrupting the export. A trustworthy progress indicator turns the long wait into a reassuring one, and a working cancel button gives the user the safe escape hatch they'd otherwise reach for by force-quitting. Both reduce the chance of shipping a broken stick to a show.

**State machine (replaces the current "Start export → dialog dismisses" flow):**

1. **Pre-export (current confirm step).** Existing UI with destination + summary. **Add pre-flight checks** before transitioning to in-progress: USB mount still present, USB writable (write+delete a small probe file), enough free space (sum of file sizes BMS plans to copy ≤ available on stick, with a small safety margin — 10 MB is fine). Failures here surface as inline errors on the confirm dialog with the specific remediation ("USB is full — N MB needed, M MB available") and keep the user on the confirm step.

2. **In-progress.** Replace the confirm content with the progress UI. Persistent header with destination path. Body:
   - **Progress bar** showing bytes copied / total bytes (not file count — files vary in size from KB `.jcs` files to multi-MB WAVs, so bytes give a smooth honest indicator).
   - **Percentage** (numeric, integer percent) next to the bar.
   - **ETA** shown as "About 2 minutes remaining" using a rolling 5-second-window byte rate. For the first 3 seconds OR first 5% (whichever comes first), show "Calculating…" — the first second of a USB write is unreliable due to cache warming and shouldn't drive an estimate the user will trust.
   - **Current file** ("Copying: ClickCues_buffy.wav") on a third line. Truncate-with-tooltip if it overflows.
   - **Cancel** button (primary placement; not destructive — the destructive intent is implicit in canceling).
   - **No close-X on the dialog header** during in-progress; the only ways out are Cancel or completion.
   - Optional: show a small `n / m files` counter alongside as a secondary signal — some users read file counts more naturally than bytes.

3. **Success.** Terminal state with a green checkmark or similar affirmative glyph. Body summarizes what landed on the stick:
   - `N songs added, M songs updated` (added = didn't exist on the stick before; updated = existed but the BMS-side content was newer or different)
   - `N playlists added, M playlists updated`
   - `N trackmaps added, M trackmaps updated`
   - Total bytes copied, total elapsed time as a footer line ("Copied 4.2 GB in 3 minutes 18 seconds")
   - **Done** button (primary), and optionally **Eject USB** (tertiary) if the existing `eject_volume` command can run from here — saves the user a Finder trip.

4. **Error.** Terminal state with a warning/error glyph. Body shows:
   - One-sentence summary ("USB write failed at file 12 of 47.")
   - Specific error details from the underlying Rust error (path, OS errno, etc.) in a smaller second block. Readable but not the headline.
   - **State of the USB** disclosed honestly ("Partial copy on USB. N files written before the error. The stick may not play correctly until you re-run the export or restore from backup.")
   - **Retry** button if the failure is transient (write timeout, USB temporarily unavailable). **Close** button to dismiss.

5. **Canceling (transient).** When the user clicks Cancel during step 2, show a short "Canceling…" state while the Rust side stops accepting new writes and performs whatever cleanup the cancellation policy demands (see Open Questions). Disable the Cancel button so a second click doesn't double-signal.

6. **Canceled.** Terminal state after cleanup completes. Body explains what state the USB is in (see Open Questions for the policy choice — every option needs honest copy here). **Close** button.

**Progress measurement (Rust → JS event channel):**

- Tauri's `Window.emit("export-progress", payload)` from Rust to stream events. JS subscribes via `listen("export-progress", handler)` in the dialog's mount effect, unsubscribes on unmount.
- Payload shape: `{ bytesCopied: number, bytesTotal: number, currentFile: string, filesCompleted: number, filesTotal: number }`. Emitted once per file boundary (cheap) — sub-file progress is overkill for files in the typical few-MB range and would flood the channel.
- For huge files (say >100 MB) consider emitting mid-file progress at 25/50/75% via the `copy_into_folder` helper. Defer until field testing surfaces a need.
- Terminal events on a separate channel: `export-complete` with the result summary, `export-error` with the error details. Keeps the in-progress channel simple.

**Cancellation signal:**

- New `cancel_export` Tauri command. Frontend invokes it on Cancel click.
- Rust side holds an `Arc<AtomicBool>` (or a `tokio::sync::watch` channel if the export becomes async) that the file-copy loop checks between file iterations. On detect, break the loop and run cleanup per the chosen policy.
- Important: cancellation should be cooperative, not preemptive. Don't kill the export thread mid-`fs::copy()` — that's how you get truncated files on the USB. Check the flag between files only.

**Implementation notes:**

- Pre-flight checks should run in a single Rust command (`prepare_export` or similar) that returns either a success token with the pre-flight summary or a typed error the dialog renders. Keeping all the FS calls on the Rust side avoids the dialog doing multiple round-trips.
- The "added vs updated" distinction in the success summary requires the export to track per-file outcomes during the run (was the target path newly created, or did it overwrite an existing file with different content?). Compute this on the Rust side and include in the `export-complete` payload — much easier than recomputing on the JS side.
- USB free-space check: `sysinfo` (already a dep for the USB enumeration) exposes `available_space` per disk. Cross-check sums in bytes before starting; surface a `not_enough_space` typed error with both numbers in the payload.
- The progress UI should follow the existing dialog visual family (`CleanupConfirmDialog`, `SaveConfirmDialog`, `SmartImportConfirmDialog`). New `ExportProgressDialog.tsx` (or fold the new states into `ExportToUsbDialog.tsx` if it stays manageable — probably split, the state machine is meaty).
- ETA computation in JS, not Rust — JS keeps a sliding window of recent `(elapsedMs, bytesCopied)` samples from the progress events and computes a rate from the last ~5 seconds. Pure UI concern; doesn't need to round-trip to Rust.
- Toast on dialog close: when Success / Error / Canceled terminal states are dismissed, fire a single-slot toast on the editor pane summarizing the outcome ("Exported 4.2 GB to /Volumes/BANDMATE"). Lets the user close the dialog and still see the confirmation. Reuses the existing `Toast` component.

**Open questions:**

- **Cancellation policy — what does "revert to pre-export state" actually mean?** Three options, increasing in complexity and in user-experience quality:
  - **(a) Best-effort, no rollback.** Cancel stops new writes; whatever was already on the USB stays. Canceled-state copy: "Export was canceled. N files were already written. The stick may be in an inconsistent state — re-run the export or restore from backup."
  - **(b) Delete-new-files cleanup.** Track which files on the USB were *newly created* by this export (not pre-existing). On cancel, delete those. Files that were *overwritten* during this export remain in their new state (we don't have the old content to restore). Canceled-state copy: "Export was canceled. New files have been removed from the USB. Files that were updated during the export remain at their new state — re-run the export to fully sync, or restore from backup."
  - **(c) Staged copy + atomic swap.** Write everything to a temporary directory on the USB first (e.g. `.bm_export_staging/`), then atomic-rename into place at the end of a successful export. Cancellation = delete the staging directory; pre-export USB content is untouched. Cleanest semantics but requires ~2× the export's disk space on the USB temporarily. Some USB stick filesystems (exFAT, FAT32) may not support truly atomic directory renames — needs a Rust-side test.

  Eric's stated requirement is "revert to the state before the export started." That points at (c) as the only fully-honest interpretation. Likely path: ship (b) as v1 (matches the requirement *for the common case where the user is exporting to a fresh stick*) with the honest "files that were updated remain at their new state" caveat; consider (c) as a future enhancement once the rest of the state machine is field-tested.

- **What happens if the USB is unplugged mid-export?** Treat as an error state with specific copy ("USB drive disconnected during export. The stick is in an inconsistent state."). Don't try to recover or wait for re-mount; the user re-runs the export. Detect via OS-level error from the write call, surface immediately. Optional polish: a background heartbeat that checks the mount every few seconds and surfaces the error sooner than the next file write would.

- **What about the `dot_clean -m` step?** Existing export pipeline runs this after the copy to strip AppleDouble files. Should it fire mid-cancel (yes, even partial exports want the stripping) or only on success (no — partial-with-AppleDouble is still wrong)? Probably run unconditionally on any cleanup path that leaves files on the stick.

- **Should the progress bar animate during pre-flight?** Pre-flight is usually subsecond — probably no UI for it. If a check turns out to be slow (free-space on a large stick can take a moment), upgrade to a tiny "Checking USB…" inline indicator before the in-progress UI takes over.

- **Persistence of the dialog through app focus changes:** if the user clicks away to another window during the export, the dialog should stay open in the background. Don't auto-dismiss on blur. (Default behavior, but worth confirming.)

**Phased proposal:**

This entry is big enough to ship in two or three PRs rather than one:

1. **PR 1 — Rust progress events + JS in-progress UI.** Pre-flight, progress bar, ETA, current-file display. Cancel button shows but invokes a placeholder that just stops new writes (cancellation policy (a) — no cleanup). Terminal Success / Error states with the summary copy. No revert yet.
2. **PR 2 — Cancellation policy (b).** Track newly-created files; delete on cancel. Canceled terminal state with honest copy.
3. **PR 3 (optional, defer) — Staged-copy policy (c).** Only if (b) feels insufficient in practice. Likely a follow-up after field use.

Ship PR 1 first — that's where the bulk of user value is (the "is it hung?" anxiety is solved). PRs 2 and 3 are quality polish on top.

**Captured:** 2026-05-14

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


