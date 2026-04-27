# BandMate Studio — dev environment setup (macOS)

One-time setup to get the BandMate Studio dev environment running on your Mac. After this you'll be able to run `pnpm tauri dev` and see live changes.

## Prerequisites

You need three toolchains: **Node.js**, **pnpm**, and **Rust**. Tauri also needs Xcode Command Line Tools for the native macOS build.

### 1. Xcode Command Line Tools

```bash
xcode-select --install
```

Click "Install" in the dialog that appears. Takes ~5 minutes. Skip if you've done this before for any prior Xcode-adjacent work.

### 2. Node.js (v20 or later)

If you don't have Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then:

```bash
brew install node
node --version    # should be v20.x or v22.x
```

### 3. pnpm

pnpm is a faster, more disk-efficient `npm` replacement. Tauri's docs default to it.

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version    # should be 9.x or later
```

(`corepack` ships with Node so this needs no separate install.)

### 4. Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Accept the defaults (option 1). After it finishes, either close-and-reopen your terminal or run:

```bash
source "$HOME/.cargo/env"
```

Verify:

```bash
rustc --version
cargo --version
```

### 5. Tauri CLI

Installed as a Rust binary (will be slow the first time — Cargo needs to compile it):

```bash
cargo install tauri-cli --version "^2.0"
```

Verify:

```bash
cargo tauri --version
```

## First run

```bash
cd "/Users/ericmorgan/Documents/Claude/Projects/Band Live Rig/improvements/bm-loader-rebuild"
pnpm install      # ~30s; pulls React, Vite, Tailwind, Tauri JS bindings
pnpm tauri dev    # ~3–5 min the first time; Cargo compiles the Rust backend
```

A native macOS window should pop up showing the placeholder UI. Hot-reload is wired up: edit any file under `src/` and the window updates instantly. Edit any file under `src-tauri/src/` and the Rust backend rebuilds (slower — ~10s).

## Common dev commands

```bash
pnpm tauri dev              # run dev mode (hot-reload)
pnpm tauri build            # produce .dmg in src-tauri/target/release/bundle/dmg/
pnpm dev                    # frontend-only dev (in a regular browser, no Tauri shell)
pnpm test                   # run the file-format codec tests (Phase 1)
pnpm typecheck              # tsc --noEmit
```

## Troubleshooting

**"unknown package 'tauri-cli'"**: your Cargo is too old. `rustup update`.

**Build hangs at "Compiling tauri-app"**: first build is genuinely slow (~5 min). Subsequent builds are fast (~5 s).

**"xcrun: error: invalid active developer path"**: re-run `xcode-select --install`.

**App window opens but is blank / shows a "vite is starting…" error**: kill the dev server (Ctrl+C) and re-run `pnpm tauri dev` — Vite occasionally races Tauri on first launch.

**Tauri keeps the wrong app icon after rebuild**: clean and rebuild — `rm -rf src-tauri/target` and `pnpm tauri build`. Tauri caches icons aggressively.

## Production build (when you want a `.dmg`)

```bash
pnpm tauri build
# output: src-tauri/target/release/bundle/dmg/BandMate Studio_<version>_aarch64.dmg
```

The `.dmg` is unsigned (i.e., macOS will warn on first launch). Code-signing + notarization is on the v0.2 list — for now, right-click → Open the first time to bypass Gatekeeper.

## When you're done with this project

Tauri produces ~1 GB of build artifacts in `src-tauri/target/` (Rust dependency cache). Cargo manages this, but you can free it up with `cargo clean` if you ever stop developing.
