# BandMate Studio — Roadmap

The canonical release roadmap for BandMate Studio. Captures release-level goals, their criteria, and the v2+ vision.

For per-PR version-bump mechanics, see [VERSIONING.md](VERSIONING.md). For polish / feature items captured outside release-level work, see [BACKLOG.md](../BACKLOG.md) at the repo root.

## v0.x — Alpha (current)

Active feature development. Single user (Eric + band) on the rig; not yet shared externally. Breaking changes can land at any minor bump.

## v0.x.0-beta — Beta Release

**Goal:** BM Studio is ready for most users to begin dogfooding as a BM Loader replacement and provide feedback on bugs or issues that will help prepare for the v1 release.

The Beta version number is whichever `0.X.0` is current when the criteria are met — no pre-reserved number.

### Criteria

1. **Working folder backwards compatibility with BM Loader.** BMS can read and write a working folder such that BM Loader sees no functional difference, and `.bandmate-studio.json` sidecars are the only Studio-only artifacts on disk (BM Loader's directory scan ignores them by extension). Verified via round-trip testing:
   - BM Loader writes → BMS reads + edits.
   - BMS writes → BM Loader reads.
   - Alternating editing across both apps over multiple sessions, no artifact buildup.
   - Byte-level parity on the `.jcs` / `.jcp` / `.jcm` formats for the deterministic parts.
2. **USB Export output matches BM Loader** on both macOS and Windows (byte-level parity for the deterministic portions of the output tree). Verified via the [USB-export parity audit](EXPORT-PARITY-TEST.md). **macOS: PASS (2026-05-14)** via the pretend-USB short form (BMS export → local destination, compared against the source working folder); Windows half pending criterion #4.
3. **BandMate hardware playback validated** — a Studio-exported USB stick plays cleanly on the BandMate hardware in a real rehearsal context.
4. **Windows build validated** end-to-end: working folder pick → song / playlist / track-map editing → USB export → BandMate playback.
5. **Users can submit feedback from within the Studio app** that lands as GitHub Issues. Implementation: a pre-filled GitHub Issues URL opened via Tauri's shell plugin, auto-populated with app version + OS context. The user authenticates with their own GitHub account in the browser to submit. No service-side secrets required.
6. **No backlog entries marked `blocking`.**

### Distribution

Beta is private. Shared with Eric's band and with Joe at JoeCo for feedback. Not publicly released.

## v1.x — Initial Release (Stable)

**Goal:** BM Studio can fully replace BM Loader for BandMate song-management workflows for any current BM Loader user. The project is cleaned, optimized, and packaged for public release.

### Criteria

1. **Baseline feature parity with BM Loader.** A typical BM Loader user can switch to BMS as their daily driver with no functional gaps.
2. **New features that improve core BandMate workflows** (song / playlist / track-map creation) beyond what BM Loader offers.
3. **Releases available for both macOS and Windows**, distributed via GitHub Releases.
4. **User Guide** documenting key features and core workflows, so users can start using the app quickly. BM Loader has no documentation today, which is a real pain point we want to fix from day one.
5. **Continue developing improvements** that focus on:
   1. Shortening + accelerating core user workflows.
   2. "Quality of life" features.
   3. Incorporating feedback from other BandMate users to ensure coverage of more diverse use cases and workflows.
6. **No backlog entries marked `blocking`.**

### Distribution

GitHub Releases for macOS and Windows. Signing / notarization decisions (Apple Developer cert, Windows code-signing cert) to be made closer to release.

## v2.x — Future Release

**Goal:** BM Studio expands to solve workflow problems beyond the initial scope of BM Loader.

**Strategic question to revisit closer to v2:** whether the features below are better positioned as part of BMS proper, or as a general "Playback Manager" product that solves song + playlist management agnostic of the playback rig (BandMate, Ableton, Logic-as-playback, etc.). If we go the general direction, we'd plan to position it as a commercial product. This decision affects which features land in v2 of BMS specifically vs. a separate codebase.

### Early feature ideas

1. **Audio playback from within the app.**
   - Listen to individual files (spot-check before exporting to USB).
   - Listen to all files in a song mixed together (simulating BandMate full-rig playback).
   - Solo / mute individual tracks during full playback.
   - Transport controls (move forward / backward in the timeline for targeted spot-checks).
2. **Audio normalization / dynamic compression.** Files often come from various export sessions with inconsistent loudness. Live shows need consistent volume per channel across songs. Early thoughts:
   - Analyze dynamic range, peak loudness, average loudness for files mapped to channels (research best practices for managing consistent loudness across audio files).
   - Set a loudness baseline target for a channel (potentially derived from a reference song the user picks: "songs from now on should match Song A's per-channel loudness").
   - Tools to apply compression / normalization / other useful dynamic editing to bring new files in line with the target. Optimize for open-source tooling.
   - Waveform view to visually compare dynamics across songs per channel.
3. **Manually extend song length.** Today BandMate playback duration is determined by the longest audio / MIDI file in a song; some bands like to "ring out" past where the longest file ends.
4. **MIDI editing.** Lightweight features to adjust program-change values or note positions in an existing file without requiring the user to re-export from their DAW.
5. **Export tools for other playback solutions.** Tooling to export songs / playlists in formats useful for Ableton, Logic, etc. — so users have a backup playback path if BandMate hardware breaks mid-show, or to accommodate tour / festival requirements that mandate a specific playback rig.

---

Captured: 2026-05-13.
