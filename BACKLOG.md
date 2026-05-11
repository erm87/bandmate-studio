# BandMate Studio — backlog

Running list of polish/refinement ideas captured outside the active phase plan. Move items into MVP-PLAN.md (or a follow-up plan) when we're ready to act on them.

Newest entries on top.

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

