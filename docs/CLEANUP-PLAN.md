# BandMate Studio — repo cleanup plan

Goal: bring the repo to a state that's healthy to build on, ready to share with Joe at JoeCo for review, and presentable enough that external contributors could orient quickly.

Phases are PR-sized. Each ends with a `pnpm bump:patch` (or `:minor` where the change is user-visible) + CHANGELOG entry. Run in order or out-of-order — they don't depend on each other except where noted.

## Phase 1 — Remove cruft (1 micro-PR, ~5 min)

- Delete `_tmp_3_3c7399f521744105a15156eb3385480a` (0-byte tool leftover).
- Audit `.gitignore` for completeness against current build artifacts.
- Verify `tsconfig.tsbuildinfo` is gitignored (it is) and remove from tracking if it ever got committed.

**Acceptance:** `git ls-files --others --exclude-standard` returns nothing surprising; `git status` is clean.

## Phase 2 — Update `README.md` (1 PR)

Current README claims "Pre-MVP scaffold; UI implementation has not started." At v0.8.1 this is dramatically wrong.

Rewrite to capture:
- **Status** (Alpha, working folder backwards-compat audit passed, three Beta criteria remaining).
- **What it does** — one-paragraph value prop. Reads/writes the same `bm_media/` working folder as BM Loader, plus features beyond it (Smart Mapping, per-row change indicators, sticky default USB destination, MIDI cleaning, etc.).
- **Quickstart** — `pnpm install && pnpm tauri dev`.
- **Links** to `docs/ROADMAP.md`, `docs/VERSIONING.md`, `BACKLOG.md`, `CHANGELOG.md`.
- **Project family note** — pointer to the parallel BandMate firmware fork if you want it discoverable.
- **License / contribution note** placeholder (filled in Phase 8).

**Acceptance:** A new reader can answer "what is this?" and "how do I run it?" without leaving the README.

## Phase 3 — Resolve `MVP-PLAN.md` (1 PR)

`MVP-PLAN.md` is a Phase-0-through-Phase-N checklist from project scaffolding. Most of it shipped; some items got refactored or dropped. `docs/ROADMAP.md` now owns release-level goals; `BACKLOG.md` owns active polish items.

Options:
1. **Archive** to `docs/archive/MVP-PLAN-2026-05-11.md` with a one-line header explaining it's a historical record.
2. **Delete** entirely; the git history preserves it.

Recommend (1) — there's narrative value in the original phased plan as a record of how the project was framed. Add a "see also" pointer from `docs/archive/` if you create the folder.

**Acceptance:** No live links to `MVP-PLAN.md` from README or other docs; it's either gone or clearly marked archival.

## Phase 4 — Audit `SPEC.md` (1 PR)

`SPEC.md` documents the BandMate hardware file-format contract. Probably still accurate but hasn't been touched since scaffolding. Audit:

- Cross-check against `src/codec/*.ts` — does every field documented in SPEC.md actually exist in the codec? Any fields the codec has that SPEC.md misses?
- Cross-check against the F-2 fix (length includes MIDI) — SPEC.md probably needs updating to match.
- Cross-check against `decompiled/per_function/playlistparse_*` — the authoritative source from BM Loader.

Then relocate: `SPEC.md` → `docs/SPEC.md`. More discoverable next to ROADMAP, COMPAT-TEST, etc.

**Acceptance:** SPEC.md matches current codec + matches decompiled BM Loader reference, lives in `docs/`.

## Phase 5 — Refresh `docs/` (1 PR)

Pass through each doc and update where it's drifted:

- **`docs/DEV-SETUP.md`** — verify the setup steps actually work on a fresh checkout in 2026. macOS-specific gotchas current? Rust + pnpm versions current?
- **`docs/SMOKE-TEST.md`** — features have shipped since May 11. Add smoke checks for Smart Mapping, per-row change dots, USB export skip-unreferenced, MIDI cleaning, Settings preferences.
- **`docs/CODEC-PARITY-AUDIT.md`** — historical findings from task #1. Audit RAN, all findings F-2 through F-8 closed. Add a header noting "completed 2026-05-13; superseded by COMPAT-TEST.md for ongoing verification."

**Acceptance:** Each doc has been opened, reviewed, and either updated or annotated with status.

## Phase 6 — Audit `src/` structure (1-2 PRs)

Look for:
- **Dead code**: exports not imported anywhere, components no longer used.
- **Misplaced files**: utility functions in component files that should live in `lib/`; one-off types embedded in components that should live in a shared `types.ts`.
- **`formatDuration` helper duplication** — already noted in the playlist Duration column backlog entry; lift into `src/lib/duration.ts`.
- **Inconsistent file naming** (kebab-case vs PascalCase).

Use `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` to surface dead code candidates. Don't be too aggressive — some "unused" exports are public API for future use.

**Acceptance:** No obviously-dead code; shared utilities in `lib/`; naming convention consistent.

## Phase 7 — Audit `logos/` (1 micro-PR)

- Inventory what's there.
- Cross-check which logos are actually referenced from the app (`src/`, `src-tauri/icons/`).
- Move unused assets to `logos/archive/` or delete.
- Consider an `ATTRIBUTION.md` if any logos are from sources requiring credit.

**Acceptance:** Every file in `logos/` is either referenced from code or explicitly marked archival.

## Phase 8 — External-readiness pass (1 PR, blocks public sharing)

Required before BMS goes public or accepts external contributions:

- **`LICENSE`** — pick one. MIT or Apache 2.0 are friendliest for a Tauri/React project. Add `SPDX-License-Identifier: <id>` header to source files (or accept that's not standard for TS projects).
- **`CONTRIBUTING.md`** — short doc covering: how to set up locally (link to `docs/DEV-SETUP.md`), the per-PR version bump convention, the CHANGELOG style, where to file bugs (existing GitHub Issues URL the Send-feedback button uses), code of conduct pointer.
- **`.github/ISSUE_TEMPLATE/`** — bug report template + feature request template. The Send-feedback button's pre-fill body is a good starting point; extract the structure.
- **`.github/pull_request_template.md`** — PR checklist (typecheck passes, CHANGELOG updated, version bumped, manual test note).
- **`CODE_OF_CONDUCT.md`** if going truly public — Contributor Covenant standard works.
- **Acknowledge the BM Loader decompilation work in the README** — give credit to the upstream project, clarify the legal posture on the decompiled reference material (it's gitignored, not redistributed; used as a reference for compatible reimplementation).

**Acceptance:** External contributor can find LICENSE, CONTRIBUTING, issue template, and orient on the codebase without asking you a question.

## Phase 9 (optional) — Documentation site (deferred)

If you eventually want polished docs for a wider audience, consider:
- Docusaurus or VitePress for a `/docs` site published via GitHub Pages.
- User guide (the v1 criterion).
- API/internals reference if anyone external wants to extend it.

Deferred until at least Beta — premature for current audience size.
