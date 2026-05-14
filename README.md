# BandMate Studio

A modern desktop companion for the JoeCo BandMate hardware — drop-in replacement for stock **BM Loader** with a faster shell, live UI ergonomics, and a few features BM Loader doesn't have. Built on Tauri (Rust) + React + TypeScript + Tailwind.

Reads and writes the same on-disk formats stock BM Loader produces — `.jcm` track maps, `.jcs` songs, `.jcp` playlists, and the `bm_media/` USB layout — so a BandMate Studio-produced USB stick is fully compatible with one produced by stock BM Loader. The same Working Folder can be edited by either app across sessions.

Built for Eric's Brigades live rig, alongside a parallel custom BandMate firmware fork (`bandmate-custom-build`).

## Status

**Alpha.** Active feature development; single-user (Eric + band) on the live rig. Breaking changes can land at any minor bump until the Beta phase opens.

Beta criterion #1 (BM Loader working-folder backwards compatibility) is **closed** as of [2026-05-14](./CHANGELOG.md); 5 of 6 criteria remain — see [docs/ROADMAP.md § Beta criteria](./docs/ROADMAP.md). Active polish items live in [BACKLOG.md](./BACKLOG.md).

## What it does

The core workflow mirrors BM Loader's: pick a **Working Folder**, create Songs / Playlists / Track Maps inside it, assign WAVs to channels, then export to a USB stick the BandMate plays back on stage. Round-trip compatibility with BM Loader is the unbreakable invariant — saved files are byte-stable for the deterministic portions of each format.

Beyond that, BandMate Studio adds:

- **Smart Mapping** — fuzzy-match incoming WAV filenames to channel labels on import; a confirmation dialog lists every proposed replacement (`current → proposed`) so the user can approve, deselect, or override per row.
- **Per-row change indicators** in the Song editor — small dots show which channels are dirty since last save, with a tooltip describing the specific change.
- **MIDI cleaning on import** — runs imported `.mid` files through the `midly` SMF parser to strip non-essential meta events (Kemper-bound MIDI must contain only events the device responds to).
- **Sticky export destination** — remembers the last USB stick used; second-time exports skip the picker.
- **Automatic `dot_clean -m` on macOS exports** — the BandMate hangs on AppleDouble `._*` files; BMS strips them as part of the export pipeline rather than relying on the user to remember.
- **Sample-rate mismatch warnings** — flags WAVs whose sample rate doesn't match the song's, both at assignment and on save.
- **Cmd+S, drag-to-reorder, Delete-to-clear, ESC** — keyboard ergonomics BM Loader doesn't have, plus an unsaved-changes guard on every navigation boundary.
- **Light / Dark / Auto color modes** — system-aware theme that follows the OS appearance setting live.

The full feature log is in [CHANGELOG.md](./CHANGELOG.md). The on-disk file-format reference is [SPEC.md](./SPEC.md).

## Quickstart

```bash
pnpm install        # node deps (React, Vite, Tailwind, Tauri JS bindings)
pnpm tauri dev      # native window with HMR; first run is slow (~5 min for cargo)
```

Detailed toolchain setup (Node 20+, Rust, Xcode CLT) lives in [docs/DEV-SETUP.md](./docs/DEV-SETUP.md). For the per-PR version-bump + CHANGELOG workflow, see [docs/VERSIONING.md](./docs/VERSIONING.md).

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | [Tauri](https://tauri.app/) (Rust) | ~15 MB bundle vs Electron's 150 MB; near-instant startup; native file dialogs and OS integration without Electron's security caveats. |
| UI | React + TypeScript | More familiar than Python or Qt; future JoeCo handoff is easier with a popular UI framework. |
| Styling | Tailwind CSS | Fast iteration, consistent design tokens, easy dark-mode support. |
| Build | Vite | Modern frontend tooling; fast dev server with HMR. |
| Audio probing | Rust [`hound`](https://docs.rs/hound/) crate | Read WAV headers (mono/stereo, sample rate, duration). Simple, reliable. |
| MIDI cleaning | Rust [`midly`](https://docs.rs/midly/) crate | Zero-copy SMF parser/writer; used to strip non-essential meta events from imported MIDI files. |
| Distribution | macOS first (`.dmg`) | Eric's rig is Mac. Windows is a Beta criterion (in progress). |

The Rust toolchain is invisible to users — they get a normal `.dmg`. Only the dev machine needs Rust + Node.

## Why a rewrite (not a fork)

JoeCo's stock BM Loader is a Python 3.12 + PySimpleGUI v2 desktop app whose source isn't public. A patched build of `pycdc` recovered ~88% of the app's functions cleanly (see [decompiled/README.md](./decompiled/README.md) — gitignored research material). That recovery is enough to validate file-format behavior against, but the codebase is dated enough that a fresh build gives us more leverage than a patch: a smaller, faster shell; live UI ergonomics (drag-to-reorder, keyboard shortcuts, dark mode); and clean-room compatibility with the on-disk formats.

Discipline note: BandMate Studio is a clean-room reimplementation. Code is never pasted from the recovered source; every codec function is reimplemented against [SPEC.md](./SPEC.md) and round-tripped through real BM-Loader-produced fixtures in [src/codec/\_\_fixtures\_\_/](./src/codec/__fixtures__/).

## Documentation

- [CLAUDE.md](./CLAUDE.md) — orientation guide for Claude Code sessions; architecture, codec invariants, the reliability principle.
- [SPEC.md](./SPEC.md) — on-disk format reference (`.jcm`, `.jcs`, `.jcp`, USB layout). The contract between BMS and the BandMate hardware.
- [docs/ROADMAP.md](./docs/ROADMAP.md) — Alpha / Beta / Stable goals and criteria.
- [docs/VERSIONING.md](./docs/VERSIONING.md) — per-PR version-bump workflow and phase semantics.
- [docs/COMPAT-TEST.md](./docs/COMPAT-TEST.md) — manual audit protocol for verifying BM Loader working-folder interoperability (Beta criterion 1).
- [docs/EXPORT-PARITY-TEST.md](./docs/EXPORT-PARITY-TEST.md) — manual audit protocol for verifying USB-export byte-parity vs. BM Loader on macOS and Windows (Beta criterion 2).
- [docs/SMOKE-TEST.md](./docs/SMOKE-TEST.md) — pre-release smoke test plan.
- [docs/DEV-SETUP.md](./docs/DEV-SETUP.md) — first-time toolchain setup on macOS.
- [BACKLOG.md](./BACKLOG.md) — active polish / feature items not yet scheduled.
- [CHANGELOG.md](./CHANGELOG.md) — release-by-release history.
- [docs/CLEANUP-PLAN.md](./docs/CLEANUP-PLAN.md) — the repo-hygiene phased plan currently being executed.
- [docs/archive/](./docs/archive/) — historical planning documents kept for reference.

## License & contribution

License: TBD. A permissive license (MIT or Apache 2.0) will be finalized in the external-readiness pass described in [docs/CLEANUP-PLAN.md § Phase 8](./docs/CLEANUP-PLAN.md).

External contributions aren't yet being solicited — BMS is in private alpha. If you're a BM Loader user interested in dogfooding the Beta when it opens, reach out to Eric.
