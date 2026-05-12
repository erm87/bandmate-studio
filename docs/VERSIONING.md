# Versioning

BandMate Studio uses [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

Pre-1.0 the semver spec explicitly carves out "anything goes" — we use the freedom to bump MINOR liberally during alpha while still keeping a clear release trail.

## Phases

We track three lifecycle phases. The current phase is encoded in `src/lib/appPhase.ts` and surfaced in the app's Settings → About panel.

### Alpha — current

- Active feature development.
- Breaking changes can happen at any minor bump.
- Single user (Eric + band) on the rig; not yet shared externally.
- Bump MINOR per PR (most PRs introduce new behavior). Bump PATCH for fix-only PRs that don't add or change behavior.

### Beta — gated by these criteria

Promote to Beta (= flip `APP_PHASE` to `"beta"`) when all four are true:

1. USB Export output of Studio matches that of BM Loader on both macOS and Windows (byte-level parity verified).
2. Performance using Studio's USB export validated in actual rehearsal (BandMate hardware playback no different from a Loader-exported stick).
3. Windows build validated end-to-end (working folder pick → song edit → USB export → BandMate playback).
4. No backlog entries marked as `blocking`.

The Beta version is whichever `0.X.0` happens to be next when the criteria are met. We don't reserve a specific number ahead of time — could be `0.8.0`, `0.11.0`, or `0.14.0` depending on cadence. Share the Beta build with Joe and any other early testers when reached.

### Stable (1.0.0) — gated by these criteria

Cut `1.0.0` when all three are true:

1. The rig has run multiple live rehearsals using a Studio-exported stick with no critical issues.
2. Joe has Q&A'd the app and approved.
3. No backlog entries marked as `blocking`.

After 1.0, the scheme tightens:

- **MAJOR** for changes that break the user's existing setup (working-folder layout changes, format-level changes to `.jcs` / `.jcp` / `.jcm`, or anything that requires the user to re-do work).
- **MINOR** for backwards-compatible new features.
- **PATCH** for backwards-compatible bug fixes.

## Workflow

Version bumps happen **per PR**. Specifically:

1. While working on your branch, when the PR is ready to merge, run one of:
   ```bash
   pnpm bump:patch    # fix-only PR (no new behavior)
   pnpm bump:minor    # new feature, new UI surface, behavior change (default)
   pnpm bump:major    # post-1.0 only: breaking changes
   ```
2. The script updates all three version files in lockstep:
   - `src-tauri/tauri.conf.json` (canonical — what the Tauri bundler reads)
   - `src-tauri/Cargo.toml` (Rust crate)
   - `package.json` (Node side, informational)
3. Amend the version bump into your commit:
   ```bash
   git add -u && git commit --amend --no-edit
   ```
4. Update `CHANGELOG.md` — add a new section under `## [Unreleased]` describing the change.
5. After merge to main, tag the release:
   ```bash
   git tag v0.X.Y
   git push --tags
   ```
   (Tags are how we can later identify which build a bug report or working folder came from.)

## Where the version surfaces

- **macOS About panel** (⌘← in any app's menu → About BandMate Studio): shows the version from the bundled `Info.plist`.
- **Settings → About** inside the app: shows the version + current phase, read at runtime via `@tauri-apps/api/app`'s `getVersion()`.
- **Git tags** (`vX.Y.Z`): every released build should have a matching tag.
- **CHANGELOG.md** at repo root: human-readable summary of changes per release, following [Keep a Changelog](https://keepachangelog.com/) format.

## Why a duplicate version shows in macOS About panels

The macOS About-window string `0.2.0 (0.2.0)` is the marketing version followed by the build number in parentheses. Apple convention: marketing version is human-readable; build number is internal-monotonic for crash-report disambiguation and App Store submissions. For a self-distributed Tauri app, having them match (Tauri's default) is fine — we're not in either of those distribution channels. We may revisit if needs change.
