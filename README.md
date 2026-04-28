# BandMate Studio

A modern, open-source replacement for JoeCo's **BM Loader** companion app. Reads and writes the same file formats (`.jcm` track maps, `.jcs` songs, `.jcp` playlists, USB layout under `bm_media/`) so the BandMate hardware sees a fully-compatible playfile USB.

Built for Eric's Brigades rig as part of the [bandmate-custom-build](../bandmate-custom-build/) project family.

## Why this exists

JoeCo's stock BM Loader is a Python 3.12 + PySimpleGUI v2 desktop app that's grown rough at the edges:

- Outdated UI, no drag-to-reorder, no keyboard shortcuts (Delete, Cmd+S, etc.)
- The `48 kHz` radio button reverts to `44.1 kHz` after confirming a New Song dialog
- Random freezes during USB copy (single-threaded UI blocks on long file ops)
- Slow startup (~5 s of PyInstaller archive extraction every launch)
- App icon reverts to a generic Python image because the bundle ID is `com.domain.project` (PyInstaller default placeholder)
- No `dot_clean` integration on macOS (Eric has to remember to run it manually after every USB write)
- No bulk editing across songs

JoeCo's source isn't available, but a patched build of `pycdc` recovered ~88% of the app's functions cleanly — see [decompiled/README.md](./decompiled/README.md). The recovered `playlistparse.py` (notably `Song.loadSong`/`saveSong` and `PlayList.loadPlaylist`/`savePlaylist`) is the authoritative reference for the file-format SPEC. We're still building a fresh app rather than patching the original — the recovered source is enough to validate behavior, but the UI is dated enough that a rewrite gives us more leverage than a patch.

## Status

**Pre-MVP scaffold.** Project structure, file-format spec, and phased work plan are written; UI implementation has not started.

See [MVP-PLAN.md](./MVP-PLAN.md) for the phased v0.1 checklist and [SPEC.md](./SPEC.md) for the file-format reference (the contract between this app and the BandMate hardware).

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | [Tauri](https://tauri.app/) (Rust) | ~15 MB bundle vs Electron's 150 MB; near-instant startup; native file dialogs and OS integration without Electron's security caveats. |
| UI | React + TypeScript | Eric is more familiar with React than Python or Qt; future JoeCo handoff is easier with a popular UI framework. |
| Styling | Tailwind CSS | Fast iteration, consistent design tokens, easy dark-mode support. |
| Build | Vite | Modern frontend tooling; fast dev server with HMR. |
| Audio probing | Rust [`hound`](https://docs.rs/hound/) crate | Read WAV headers to detect mono vs stereo, sample rate, duration. Simple, reliable. |
| Distribution | macOS first (`.dmg`) | Eric's rig is Mac. Windows packaging deferred to v0.2 (Tauri makes this almost free). |

The Rust toolchain is invisible to anyone using BandMate Studio — they get a normal `.dmg`. Only the dev machine needs Rust + Node.

## Local dev

See [docs/DEV-SETUP.md](./docs/DEV-SETUP.md) for the step-by-step. TL;DR:

```bash
# one-time toolchain setup on your Mac
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# this repo
cd improvements/bm-loader-rebuild
pnpm install        # node deps (React, Vite, Tailwind, Tauri JS bindings)
pnpm tauri dev      # spin up dev server with hot-reload + a live macOS app window
```

## Project layout

```
bm-loader-rebuild/
├── README.md                # ← you are here
├── SPEC.md                  # .jcm / .jcs / .jcp file format reference
├── MVP-PLAN.md              # phased v0.1 work checklist
├── docs/
│   └── DEV-SETUP.md         # install Rust + Node, run locally
├── package.json             # frontend deps (React, Vite, Tailwind, Tauri)
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── index.html
├── src/                     # React frontend
│   ├── main.tsx             # React entry
│   ├── App.tsx              # top-level layout
│   ├── index.css            # Tailwind imports
│   └── types.ts             # TypeScript types matching SPEC.md
└── src-tauri/               # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    └── src/
        └── main.rs          # Rust entry, command handlers
```

## License

MIT (TBD — Eric's call, can be relicensed as needed if JoeCo ever adopts).
