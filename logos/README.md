# logos/

Brand-asset library for BandMate Studio. Production build outputs live in [../src-tauri/icons/](../src-tauri/icons/) (the app icon set Tauri bundles) and [../src/assets/](../src/assets/) (PNGs imported by Vite for in-app rendering); this directory holds the **sources** those are derived from, plus alternate-resolution and vector variants kept for future asset work.

## Structure

### `bandmate-studio-icon/` — current BMS app icon source

The active source-of-truth for the desktop app icon. `concept-B-wave.svg` is the vector master; the regeneration flow (rasterize → `pnpm tauri icon …`) is documented in [bandmate-studio-icon/README.md](./bandmate-studio-icon/README.md). `concept-A-knob.svg` and `concept-C-ripples.svg` are earlier concept sketches kept for reference.

### `joeco-logo-neon-retina-flat-250718.png` + `joeco-logo-white-retina-flat.png` — production JoeCo logos

The neon and white JoeCo logos used in the app header. These are byte-identical to the in-use `src/assets/joeco-logo-neon.png` and `src/assets/joeco-logo-white.png` (the `src/assets/` copies are what Vite imports for `EmptyState` and `WorkingFolderBar`). Keep this directory's copies in sync if `src/assets/` is updated, or vice versa.

### `vectors/` — JoeCo vector source-of-truth

`joeco-logo-neon.svg` and `joeco-logo-white.svg`. Use these as the starting point for any new rasterizations — render a higher-res PNG from here rather than upscaling an existing raster.

### `highres/` — multi-resolution JoeCo rasterizations

Pre-rendered PNGs at `@1x` through `@16x` plus `2048w` / `4096w` variants of both the neon and white logos. Reference library for future asset swaps (e.g., bumping `src/assets/joeco-logo-*.png` to a higher-res variant for a high-DPI build).

### `archive/` — superseded assets

Material no longer in active use but kept in-repo for reference rather than deleted.

- `archive/bandmate-app-icon/` — the original BMS app icon set generated at project scaffolding (PR #1, 2026-05-11). Superseded by the `bandmate-studio-icon/concept-B-wave.svg` flow in PR #13 "Polish pass: app icon…" (2026-05-12). The current `src-tauri/icons/` icon set comes from that newer flow, not from these files.

## When you change brand assets

If you replace the JoeCo logos used in-app, update **both** the byte-identical pair (this directory's top-level + `src/assets/`) so they stay in sync. The simplest path is to copy from `vectors/` → re-export PNG → drop into both locations.

If you change the app icon, edit `bandmate-studio-icon/concept-B-wave.svg` and re-run the regeneration flow in that subdirectory's README — that updates `src-tauri/icons/` directly and bundles into the next `pnpm tauri build`.
