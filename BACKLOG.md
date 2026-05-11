# BandMate Studio — backlog

Running list of polish/refinement ideas captured outside the active phase plan. Move items into MVP-PLAN.md (or a follow-up plan) when we're ready to act on them.

Newest entries on top.

---

## USB Export — persist last-used destination within a session

**Where:** `ExportToUsbDialog.tsx`. The dialog's open-effect (`useEffect` at line 57) currently resets `destPath` to `null` every time `isOpen` flips to true, so each export round starts from scratch even within the same session.

**Idea:** Remember the last destination chosen during the current session. Next time the user opens the Export dialog, pre-select that path and skip straight from `"pick"` to `"confirm"` (with the ability to back out and choose a different folder via a "Change…" button next to the path).

**Why:** Common workflow during a working session is: export → notice a small fix → make the fix → export again → repeat. Today each iteration forces the user back through the native folder picker to re-locate the same USB mount, which is friction at exactly the wrong moment (they're iterating). Session-level persistence makes the second-through-Nth export close to one-click.

**Implementation notes:**
- Two layers: **session memory** (this entry) + **persistent default** (next entry). They share state plumbing — session memory wins when set, otherwise fall back to the persistent default, otherwise fall back to today's "show picker" behavior.
- Store the last destination in `AppState` (not in the dialog's local `useState`) so it survives the dialog being closed + reopened. Field: `state.lastExportDestPath: string | null`.
- On dialog open: if `lastExportDestPath` is set, **verify it still exists** before pre-selecting (the USB stick may have been ejected/unmounted between exports). If it doesn't exist, fall through to the picker as today and clear the cached path.
- Macs unmount and re-mount USB volumes at the same `/Volumes/<NAME>` path generally, so the path tends to stay valid across eject/reinsert — verification on existence is enough.
- Pass `defaultPath` to Tauri's `open()` when the user *does* click "Change…" so the picker opens in the same vicinity as last time.
- Clear `lastExportDestPath` when the working folder changes (the previous USB stick probably belongs to a different project).

**Captured:** 2026-05-11

---

## Settings — Default USB Export destination

**Where:** Settings dialog → **Defaults** section (`SettingsDialog.tsx`, alongside Default Sample Rate / Default Track Map). `userPrefs` in `persistence.ts`. Consumed by `ExportToUsbDialog.tsx`.

**Idea:** Add a **Default USB Export destination** preference. When set, the Export to USB dialog opens with that path pre-selected — same flow as the session-memory entry above, but the value is sticky across app restarts. The user can override per-export.

**Why:** Most bands export to the same physical USB stick (or the same external SSD partition) week after week. Persisting it as a setting means a fresh app launch still goes straight to "confirm + export" instead of "find the stick again."

**Implementation notes:**
- New field on `userPrefs`: `defaultExportDestPath?: string` — stored as an absolute filesystem path (e.g. `/Volumes/BANDMATE`).
- Settings UI: a path display + "Choose…" button + "Clear" button. Use the same Tauri `open({ directory: true })` picker the export dialog uses.
- Resolution order in the export dialog when it opens:
  1. **Session memory** (`state.lastExportDestPath`, from the entry above) — set after a successful export this session.
  2. **Persistent default** (`userPrefs.defaultExportDestPath`) — from Settings.
  3. **Picker** — today's behavior, no path pre-selected.
- Existence check: same as session memory. If the persistent default points at a path that doesn't exist (stick unplugged), don't error — silently fall through to the picker and show a small "Last-used USB volume not currently mounted" hint.
- Macs: most external USB sticks mount at `/Volumes/<NAME>`. That path is stable across remounts of the *same* stick, so this works reliably. Worth noting in the Settings UI that this is a remembered mount point, not a magic auto-detector.
- Could later evolve into "remember per working folder" if Eric runs multiple rigs/sticks — for v1, one global default is enough.

**Captured:** 2026-05-11

---

## Source/Song Folder list — show duration for MIDI files

**Where:** `SourceFilesPane.tsx`, the `subtitle` builder inside `FileRow` (~line 540). Today WAVs render `"48.0 kHz · mono · 2:47"`; MIDI rows render the literal string `"MIDI"` with no length.

**Idea:** Add `mm:ss` length to the MIDI subtitle so MIDI files carry the same scannable duration info as WAVs — e.g. `"MIDI · 2:54"` (or just `"2:54"` since the green text color + "MIDI" tag already convey the file type).

**Why:** The data is already computed and available — `AudioFileEntry.durationSeconds` is populated for both WAV and MIDI (Rust side: `midi::duration_seconds` walks the SMF events + tempo map). The UI just isn't surfacing it for MIDI rows. Showing length helps the user quickly spot mis-rendered MIDI exports (e.g. a 0:04 file where they expected 3:30 means Logic dropped most of the track), and matches the level of detail already shown for audio.

**Implementation notes:**
- One-line change in `subtitle`: replace the current `if (file.kind === "mid") return "MIDI";` early return with a builder that uses `file.durationSeconds` to format `mm:ss` and falls back to `"MIDI"` alone when `durationSeconds == null` (probe failed — should be rare).
- Reuse the same `mm:ss` formatting already used for WAVs to keep the look consistent (extract to a `formatDuration(seconds)` helper if it isn't one yet).
- The green "MIDI" tag pill stays where it is — the subtitle line is just adding the length.
- Verify in both tabs: Source Folder (where the user is browsing external MIDI exports pre-import) and Song Folder (post-import view).

**Captured:** 2026-05-11

---

## Editor pane — eliminate flicker when switching between songs / playlists / track maps

**Where:** `EditorPane.tsx` (the right-pane router). Today it does:

```tsx
case "song":      return <SongEditor    key={sel.jcsPath} jcsPath={sel.jcsPath} />;
case "playlist":  return <PlaylistEditor key={sel.path}    jcpPath={sel.path} />;
case "trackMap":  return <TrackMapEditor key={sel.path}    jcmPath={sel.path} />;
```

The `key` prop is *explicitly* used to force unmount/remount of the entire editor on every selection change (the file header even calls this out as the intended refetch mechanism). That's what produces the full-area blink visible when the user clicks between sidebar entries.

**Idea:** Restructure so that components and chrome shared across editors stay mounted, and only the data inside swaps. The user perceives this as a polished, "same surface, content updates" transition rather than a destructive remount.

**What's actually shared between the three editors (audit pass):**
- The pane's outer container, scrollbar, dark-mode background.
- The header strip: title area, header actions (undo / redo / history / Save buttons).
- The 25-row channel column structure (Song + TrackMap both render a similar left grid).
- The Save / dirty-state machinery (each editor wires its own, but the **button** is the same component in the same spot).
- The right-side info pane (Song's Source Folder / Song Folder tabs is unique to song, but its frame — sticky right column — could be reusable scaffolding).

**Best-practice strategies to research and pick from:**
1. **Drop the `key` prop, lift data fetching out of the editor.** Move the per-selection load into a single hook in `EditorPane` (or one level up) that takes `sel` and returns the parsed model. Editors become controlled components that re-render with new props instead of unmounting. The shared chrome (header, grid skeleton) keeps the same React tree across selections, so React diffs in place and there's no blink. This is the highest-leverage change and probably most of the fix on its own.
2. **Stable shared layout component.** Introduce `<EditorShell>` that owns the header strip + grid skeleton + right-rail slot. Each editor renders *into* it via children/slots (`<EditorShell title={…} actions={…} rightRail={…}>{grid}</EditorShell>`). When selection changes, `<EditorShell>` stays mounted; only the content inside slots is swapped. Pairs naturally with #1.
3. **View transitions API** (`document.startViewTransition`, or React 19's `<ViewTransition>` if/when we adopt it). Browser-level crossfade/morph between the two states. Cheap to bolt on once the DOM stays mostly stable across the transition, but it's polish on top of #1+#2 — won't fix anything if we're still unmounting the world. Worth a small spike to see how it feels.
4. **Suspense + cached resources.** If the per-editor load is what we're trying to avoid blocking on, wrap it in a Suspense boundary with a `useDeferredValue(selection)` so the previous editor stays visible until the next one's data is ready. Combined with #1, this means *no* flash of empty content even when the new selection is uncached.
5. **Skeleton/optimistic placeholders inside the editor body.** When new data is loading, the header + grid scaffold remain rendered with empty rows / skeleton lines, instead of the whole pane disappearing. This is the safety net for when #4 isn't viable (e.g. loads that take more than ~100ms).

**Why this matters (besides feeling nicer):** the channel grid is the user's primary work surface — re-rendering it from scratch on every sidebar click is also extra DOM churn and a tiny perf hit on lower-end machines. A stable tree is both prettier and faster.

**Order of operations when picking this up:**
1. Audit each editor's mount-time effects — anything that *relied* on remount semantics (one-shot effects, focus restoration, scroll resets, baseline snapshots in undo stacks) needs to be moved to an explicit `useEffect([sel])` instead. The current `key`-based remount is hiding some "happens on selection change" logic that we'll need to surface deliberately.
2. Extract the shared chrome into `<EditorShell>`.
3. Lift data loading; remove the `key` prop.
4. Layer in view transitions / Suspense polish.
5. Manual QA pass: switch rapidly between every combination of song↔playlist↔trackMap, with and without unsaved changes, and confirm the unsaved-changes guard still fires correctly (it currently hangs off the selection-change path).

**Captured:** 2026-05-11

---

## App icon — design a real BandMate Studio icon from the JoeCo neon logo

**Where:** `src-tauri/icons/` (currently shipping the default Tauri green-square placeholder set: `icon.icns`, `icon.ico`, `icon.png`, plus the `Square*Logo.png` Windows store sizes). There's already a `logos/bandmate-app-icon/` folder with placeholder renders + an `.icns`, but the running app still shows the green square — either those weren't wired into the Tauri config or the design needs another pass.

**Idea:** Design a simple, modern app icon based on the **JoeCo neon logo** (`logos/vectors/joeco-logo-neon.svg`, hi-res renders in `logos/highres/joeco-logo-neon-*.png`). Aim for an icon that reads cleanly at macOS Dock sizes (16/32 up through 1024) and feels at home next to other modern Mac app icons.

**Design notes / direction:**
- **Source mark:** start from the neon JoeCo "JC" / wordmark. Distill, don't just crop — full wordmarks read poorly at 32px. Consider a monogram (J + C) or an abstracted glyph derived from the neon outline.
- **Modern macOS shape language:** rounded-square ("squircle") shape, full-bleed background, subtle inner gradient or material — match the macOS Big Sur+ icon grid (824 × 824 within a 1024 canvas).
- **Color:** neon palette from the source logo (electric blue / cyan / magenta range) on a deep / near-black background so the neon "glows." Avoid the current flat green square entirely.
- **Identity tweak:** since this is *BandMate Studio* (not JoeCo's BandMate hardware), find a way to differentiate — e.g. a small "S" tail, a play-triangle integrated into the monogram, or a subtle waveform/spectrum motif behind the mark. Should still be unmistakably from the same family as JoeCo's branding.

**Deliverables:**
- Source SVG (vector master).
- PNG renders at every size in `src-tauri/icons/` (16, 32, 64, 128, 128@2x, 256, 512, 1024) plus the Windows `Square*Logo.png` set and an `.ico`.
- macOS `.icns` bundle.
- Wire into `src-tauri/tauri.conf.json` under `bundle.icon` so the next build actually picks it up. (Verify — the current green square suggests either the path is wrong or the bundled icon set is still the Tauri default.)

**Open questions:**
- How "JoeCo-branded" should it be? Studio is our fork — fully matching JoeCo branding could read as official; differentiating too much loses the visual lineage. Lean toward "clearly related, clearly distinct."
- Worth doing 2–3 rough directions and picking, rather than committing to a single sketch — Eric to choose.
- Light- vs. dark-mode variants? macOS Dock icons don't theme, so one design needs to work on both light and dark Dock backgrounds.

**Captured:** 2026-05-11

---

## Settings — Default Track Map preference

**Where:** Settings dialog → **Defaults** section (`SettingsDialog.tsx`, alongside Default Sample Rate). `userPrefs` in `persistence.ts`. Consumed by NewSongDialog / NewPlaylistDialog (and anywhere else that needs an initial track-map selection).

**Idea:** Add a **Default Track Map** preference in Settings. The chosen track map is what's pre-selected in the track-map picker when creating a new song or new playlist.

**Why:** Most bands settle into one track map for the bulk of their material (e.g. their stage layout's channel-to-label mapping). Forcing the user to pick it every time they make a song/playlist is friction. A per-user default removes that step while still letting them override when needed.

**Implementation notes:**
- New field on `userPrefs`: `defaultTrackMapJcm?: string` — store as the track-map filename (e.g. `"default.jcm"`, `"stems.jcm"`, `"Diff_Test.jcm"`), not an in-memory id. Filenames are the stable identifier across working folders and survive renames-as-replace.
- Default value: `"default.jcm"` (the seeded one), so brand-new users still get sensible behavior with no setting needed.
- Settings UI: dropdown / select listing all current track maps in the working folder. If the pref points to a track map that no longer exists (deleted/renamed), surface this gently — fall back to `"default.jcm"` for new-song-creation purposes, and show an inline note in Settings ("Last chosen default no longer exists — falling back to *default*").
- Show the **Template** badge from the sidebar-grouping backlog item next to seeded entries in the dropdown too, for consistency.
- New-song / new-playlist dialogs use the pref to seed the picker's initial value but allow override (i.e. it's a starting point, not a lock).
- Consider: when there's only one track map in the working folder, hide the picker entirely in New Song/Playlist dialogs (it's already the only option) — orthogonal cleanup but related.

**Open questions:**
- Per–working-folder vs. global? `defaultSampleRate` is currently global (`userPrefs`), which makes sense for sample rate. Track maps are working-folder-specific (the filenames only mean something within one folder). Two options: (a) store globally but treat as a hint that gets re-resolved per folder, or (b) store per-working-folder in a separate per-folder prefs file. Recommend (a) for v1 simplicity — the fallback path handles the cross-folder mismatch case cleanly.

**Captured:** 2026-05-11

---

## Sidebar — group seeded track maps separately from user-created ones

**Where:** Left sidebar's **Track Maps** section (`Sidebar.tsx`).

**Idea:** Visually separate the two seeded track maps (**default** and **stems**) from user-created track maps:
- Render the seeded entries as a small group at the top of the section, followed by a **subtle hairline divider** (e.g. `border-t border-zinc-200 dark:border-zinc-800`, with a bit of vertical padding) before the user-created list begins.
- Add a low-emphasis **"Template" badge** to the right of each seeded row — outline or muted gray-filled style (not brand color, not a primary pill), so it reads as a label, not an action.

**Why:** "default" and "stems" are seeded automatically for every new working folder, so when the user adds their own track maps, alphabetical ordering ends up interleaving them between the two seeded ones (e.g. `default` → `Diff_Test` → `stems` in the current screenshot). Splitting the two seeded items across the user's list is awkward — it makes the seeded entries feel like ad-hoc user data instead of starter templates, and it makes the user's own track maps harder to scan at a glance. Grouping the templates and tagging them clarifies their role and keeps the user's list contiguous.

**Open questions / details:**
- Source of truth for "is this seeded?" — likely a known-name allowlist (`["default", "stems"]`) for v1, since these are the only two we ship. If we ever let users *create more* templates, this needs a real `isTemplate` flag on the track-map metadata.
- Within each group, sort alphabetically as today.
- Does the same treatment apply to Songs / Playlists? Currently there are no seeded songs or playlists, so this is Track-Maps-only — but if we ever add seeded playlists (e.g. an example), the same pattern should extend.
- Badge styling — define as a reusable `<Badge variant="muted">` so the same component can be reused for other non-emphasized metadata in the app (e.g. file counts, MIDI flags).
- Drag-and-drop behavior: should reordering across the divider be blocked? Probably yes — users shouldn't be able to drag a seeded template *below* the divider or a user track map *above* it. Track-map ordering may not be user-controlled today; if it's purely alphabetical this is a non-issue.

**Captured:** 2026-05-11

---

## Track-map label input — Enter commits and returns row to selected state

**Where:** Track Map editor row input (`TrackMapEditor.tsx`, the `<input>` rendered per channel row). Likely also applies anywhere else we have inline name inputs on selectable rows (song/playlist sidebar rename, etc. — worth auditing).

**Idea:** When typing a label into a row's input, pressing **Enter / Return** should commit the current value and return focus from the input to the row itself, leaving the row in its **selected** state.

**Why:** The current flow leaves focus inside the input after typing, which means the editor's keyboard shortcuts (↑ / ↓ to reorder, × to clear, etc.) don't work without an explicit click elsewhere to deselect the input. Enter is the natural "I'm done with this label" signal — committing + returning to selected state lets the user fluidly type a name and then immediately reorder with the keyboard, without reaching for the mouse.

**Behavioral details to confirm when implementing:**
- Enter blurs the input but keeps `selectedRow === idx` (i.e., the brand-blue selection highlight and side-bar stay).
- Escape should *also* be handled — probably reverts to the last-committed value and blurs, matching standard input conventions. (Open question: do we already debounce/commit-on-change? If commit is per-keystroke via `onLabelChange`, "revert on Escape" needs a snapshot.)
- Verify shortcut handlers in the `useEffect` that registers ↑/↓/× will fire correctly once focus is on the row container (or on `document.body`) instead of the input — they currently guard with `selectedRow !== null`, so this should Just Work as long as we don't accidentally clear selection on blur.
- Tab should keep its default behavior (move focus to next focusable element) — not be remapped.

**Captured:** 2026-05-11

---

## "Export to USB" — demote from primary to tonal button style

**Where:** App header / top bar — the "Export to USB" button next to the working-folder path.

**Idea:** Restyle the "Export to USB" button from primary (solid blue) to a **tonal / lower-emphasis** style. Still visually distinct from the adjacent "Change" button (which is our tertiary/outlined style), but no longer competing with primary actions inside the main content area.

**Why:** Export to USB is a *persistent* top-bar control that only gets used at the end of a workflow — once you're done editing songs/playlists/track maps and want to transfer the result to the BandMate stick. The much more frequent in-app actions (creating songs, creating playlists, saving edits, etc.) are the real primaries during day-to-day use. By styling Export as a solid blue primary, the top bar pulls focus away from those workflow-level primaries and flattens the hierarchy. A tonal style keeps it discoverable without making it the loudest thing on screen.

**Target hierarchy in the top bar:**
- **Primary (solid blue):** reserved for the active in-context primary action (e.g., "Save" when editing a track map, dialog confirm buttons, etc.).
- **Tonal (proposed, e.g. blue-tinted background with blue text, no border):** "Export to USB".
- **Tertiary (outlined / ghost):** "Change", settings gear, refresh.

**Open questions:**
- Exact tonal palette — likely a `bg-blue-50 text-blue-700 hover:bg-blue-100` style (Tailwind), but should be defined as a reusable `Button` variant rather than ad-hoc classes so we can apply it consistently.
- Does this imply a wider audit of button variants across the app? Probably yes — once we have a tonal tier defined, other places (e.g. "Refresh" actions, optional secondary CTAs) may want it too. Worth doing the Button-component cleanup as part of this.
- Confirm "Save" stays solid-primary when it's the active context — that's the one we don't want Export to compete with.

**Captured:** 2026-05-11

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

## File listing — show created / modified dates

**Where:** Source Folder and Song Folder tabs (`SourceFilesPane.tsx`), file rows for audio and MIDI tracks.

**Idea:** Add **date created** and **date last modified** to the metadata shown for each file.

**Why:** Helps the user identify which files in those folders are the most recent — especially useful when re-importing from a Logic export folder that accumulates multiple takes/renders over time, or after re-rendering a stem and needing to confirm which version is current.

**Open questions:**
- Display format: relative ("2 days ago") vs. absolute ("2026-05-09 14:32")? Probably absolute for unambiguous comparison, possibly relative on hover.
- Both dates, or just modified? Created is useful when files keep being renamed/overwritten; modified is the more common signal.
- Where in the row layout — secondary line under filename, or extra columns?

**Captured:** 2026-05-11
