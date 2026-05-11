# BandMate Studio — backlog

Running list of polish/refinement ideas captured outside the active phase plan. Move items into MVP-PLAN.md (or a follow-up plan) when we're ready to act on them.

Newest entries on top.

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
