# BandMate Studio — repo hygiene plan

A living plan for keeping the repo healthy as features accumulate. Companion to [docs/CLEANUP-PLAN.md](CLEANUP-PLAN.md) — that doc is a one-shot phased list to bring the repo to a sharable baseline. This one is about *staying* clean from here on.

The framing throughout: **this app drives a live performance rig.** Hygiene tasks here protect against the slow-drift class of bug — the stale fixture that masks a real codec regression, the README that says we still don't have a UI, the dependency advisory we never read. None of these are individually load-bearing; together they're how the repo stays trustworthy through the alpha → beta → stable arc.

The structure is a **four-layer mechanism model**: CI gates on every PR (Layer 1) for the deterministic things; cloud-scheduled Routines (Layer 2) for the drifty things; local pre-commit hooks (Layer 3) for the things you'd rather catch before the CI round-trip; and process / habits (Layer 4) for the judgment calls that don't automate. A **phased rollout** at the end of the doc orders the actual implementation work cheapest-highest-leverage.

Re-read this doc before each release-phase flip. Update it when a mechanism stops earning its keep or a new debt surface emerges.

## Where debt actually accumulates

The categories that have bitten or look likely to bite for this codebase:

- **Doc drift.** `README.md`, `CLAUDE.md`, `SPEC.md`, `docs/ROADMAP.md`, `docs/SMOKE-TEST.md`, `BACKLOG.md`, `CHANGELOG.md`. Each can independently fall behind reality. The README at "Pre-MVP scaffold" while the app was at v0.8.3 (pre-cleanup) was a clear example.
- **Version-file desync.** The four version files (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`) plus the matching `CHANGELOG.md` entry. One forgotten step = CHANGELOG advertises a version the binary doesn't show. The bump script already enforces the four-file lockstep; the CHANGELOG-must-have-matching-entry rule isn't gated yet.
- **Backlog staleness.** Entries that shipped but never got pruned; entries with no follow-up activity that stop being useful as a planning surface.
- **Repo cruft.** Tool leftovers (`_tmp_*`), AppleDouble files (`._*`, `.DS_Store`) on macOS, orphan asset files, stale branches.
- **Dependency staleness.** Tauri / Vite / React / Tailwind / Rust crates falling behind, security advisories accumulating, deprecated APIs biting on major upgrades.
- **Dead code.** Unused exports / components / utilities after refactors.
- **Codec parity drift.** BM Loader could ship a new format quirk between BMS audits, causing silent divergence. Stale fixtures in `src/codec/__fixtures__/` that don't reflect current BM Loader output let a regression pass tests.
- **Architectural drift.** Design conventions (the four in `CLAUDE.md`) getting violated as features get rushed.
- **Skipped pre-release audits.** Forgetting to re-run the compat audit or the smoke test before a release-phase flip.

## The four-layer model

Different debt types want different mechanisms. Treating them all the same is the trap.

### Layer 1 — CI on every PR

What it covers: anything that *must pass before merge*. Deterministic, mechanical, fast. Trigger: every push to a PR branch.

- `pnpm typecheck`
- `pnpm test` (the 42-test vitest suite)
- `cargo check` (catches Rust errors faster than a full build)
- A `check-version-sync` script that verifies the four version files all show the same version string. Exits non-zero on mismatch.
- A `check-changelog-entry` script that verifies the current `package.json` version has a corresponding `## [<version>] —` header in `CHANGELOG.md` that isn't sitting under `## [Unreleased]`. Exits non-zero on mismatch.
- **Codec round-trip rule.** If the PR touches `src/codec/{jcm,jcs,jcp}.ts`, the vitest fixture suite must pass *and* no test should have been modified to make it pass. The fixtures are the contract — this is mostly a code-review discipline rather than an automatable check, but call it out as a CI-gated invariant.

Implementation: GitHub Actions workflow at `.github/workflows/ci.yml`. Mark `main` as protected with the CI workflow as a required check so PRs can't merge red.

Why CI rather than Routines for this layer: CI runs on every PR with no rate limits, is free for public repos, well-understood by anyone who'll ever touch the code, and the failure surface (PR can't merge) is the right one. See *Routines: where it fits* below for the rate-limit reasoning.

### Layer 2 — Routines for scheduled hygiene

What it covers: things that *should* happen periodically but never on a hard deadline. The "I really should check X" category that otherwise gets forgotten for months. Trigger: scheduled cron-style on Anthropic's cloud, or a GitHub event / API trigger.

Routines run on Anthropic's cloud infrastructure, can open draft PRs autonomously but never auto-merge. That's exactly the property this layer wants: surface findings without you, decision still requires your review.

Recommended Routines for BMS:

- **Weekly: dependency update sweep.** Run `pnpm outdated` and `cargo outdated`. For minor/patch updates, open one draft PR per ecosystem (npm + cargo) with the upgrade. Skip major updates — surface those in the PR description under "Requires manual review" but don't actually upgrade them. Include each updated dep's changelog excerpt. Run `pnpm typecheck && pnpm test` after upgrading and include the result. The Rust side gates a live performance — security advisories on `hound`, `midly`, or the Tauri plugins are worth chasing even at low severity if they touch file I/O.
- **Weekly: backlog freshness.** Read `BACKLOG.md`. For each entry, check whether the relevant code area has been touched in recent commits without the entry being closed, or whether the entry is older than 60 days with no related CHANGELOG mentions. Open a draft PR flagging candidates for triage — don't actually remove entries, just propose.
- **Monthly: doc drift detection.** Compare `README.md`, `CLAUDE.md`, `SPEC.md`, `docs/ROADMAP.md` against the current codebase. Flag stale claims (version numbers, feature status, file references that no longer exist). Open a draft PR with proposed corrections.
- **Monthly: dead-code scan.** Run `tsc --noEmit --noUnusedLocals --noUnusedParameters` and grep for exported symbols not imported anywhere outside their own file. Open a draft PR removing obvious dead code; flag ambiguous cases (public API for future use) as comments rather than removing. The Phase 6 src-audit in CLEANUP-PLAN.md established this as a one-shot pass — this Routine makes it recurring.
- **Quarterly-ish: codec fixture refresh reminder.** `src/codec/__fixtures__/` should occasionally be regenerated against current BM Loader output. A Routine can't refresh fixtures itself (requires BM Loader UI) but it can post an issue every 90 days reminding you to do it, especially if BM Loader has shipped a new release since the last refresh.

All output is draft PRs or issues that you review and decide on. None auto-merge.

### Layer 3 — Pre-commit hooks (optional)

What it covers: catching the same things as CI, but earlier in the loop — before the commit even lands locally. Saves the CI round-trip when you've forgotten something obvious. Trigger: `git commit` locally.

Implementation: [`husky`](https://typicode.github.io/husky/) running:

- The `check-version-sync` script (same one CI uses).
- The `check-changelog-entry` script.
- Optionally `pnpm typecheck` (slow on large repos; BMS isn't large yet).

Lower priority than Layer 1 because CI catches the same things. Add this only if you find yourself hitting "oh I forgot to bump" frequently enough to be annoying.

### Layer 4 — Process and habits

What it covers: judgment calls that don't automate, and triggered events that fire on real-world cues rather than schedules. The cadence subsections below are the actual operational checklist for the rig.

#### Per-PR (every merge — discipline beyond the CI gates)

The version-bump workflow already encodes most of this; the list below is the discipline that surrounds it.

- **Read your own diff before merging.** Already in practice. Already saves you from the bulk of mistakes.
- **`git status` clean before push.** Watch in particular for: `_tmp_*` scaffolding leftovers at the repo root, `.DS_Store` / `._*` AppleDouble files, `tsconfig.tsbuildinfo` (gitignored but easy to add accidentally), `src-tauri/target/` artifacts.
- **CHANGELOG group selection.** Added / Changed / Fixed / Documentation / Notes per Keep a Changelog. Group placement is judgment, not automation.
- **User-visible features → docs check at merge time.** If the PR adds or changes a feature a user can see in the UI, the author runs the *Triggered* checks below (SMOKE-TEST coverage, README accuracy, CLAUDE.md alignment) *in the same PR* — not "in a follow-up," and not waiting for the monthly doc-drift Routine. The Phase 5 docs-refresh in CLEANUP-PLAN.md had to backfill five SMOKE-TEST groups for features shipped between v0.4 and v0.8; that backfill should never have been needed.

#### Per phase-flip (alpha → beta, beta → stable)

Triggered by editing `APP_PHASE` in [src/lib/appPhase.ts](../src/lib/appPhase.ts). These are intentionally heavier than a normal PR — a phase flip is a public-facing commitment that the criteria are met.

Before merging the phase-flip PR:

- **Public criteria walkthrough.** Open [docs/ROADMAP.md](ROADMAP.md) and tick each criterion against a *concrete artifact*: the CHANGELOG entry that closed it, the COMPAT-TEST run that verified it, the screenshot or commit that proves it. If a criterion is "in progress" or "mostly done," it isn't done.
- **Personal gates walkthrough** (alpha → beta only; documented in [CLAUDE.md § Design conventions](../CLAUDE.md#design-conventions)). Multi-rehearsal live-rig validation + Q&A pass with Joe at JoeCo on the BM Loader compatibility surface. Neither is an externally verifiable checkbox; surface in the PR description that both have happened.
- **`[Beta blocker]` / `[v1 blocker]` sweep.** `grep -i 'blocker' BACKLOG.md` returns zero hits matching the phase being entered.
- **Compat-test rerun** if anything in the codec or USB-export pipeline shipped since the last run. Don't trust a stale audit; the [docs/COMPAT-TEST.md](COMPAT-TEST.md) protocol is fast enough to rerun.
- **Smoke-test rerun on a *fresh* working folder.** Walk [docs/SMOKE-TEST.md](SMOKE-TEST.md) front to back on a clean working folder, not a developer-cached one. Phase flips should not be the moment a regression is discovered.
- **CHANGELOG `Notes` for the bump entry** explicitly calls out the phase transition and links the ROADMAP section.
- **Tag and push.** `git tag v0.X.Y && git push --tags` per the versioning workflow — a phase flip is exactly the kind of milestone that wants a clean tag for future bisection.

A one-off "release readiness" Routine (Phase H6 below) can pre-flight this checklist and post it as an issue before the flip. It can *remind* you the audit is due; executing it is still you.

#### When a user-visible feature ships

- **README accuracy pass.** Does the README's feature list still describe what BMS actually does? Phase / version line still correct? Anything "new since you last looked"?
- **SMOKE-TEST coverage.** New feature → new smoke check. Add at feature-merge, not at the next docs-refresh.
- **CLAUDE.md alignment.** If the feature changes an architecture invariant, a design convention, or a per-PR workflow, update CLAUDE.md in the same PR. Cross-session Claude instances rely on it; drift here directly costs you on the next pickup.

#### When BM Loader ships a new release

- **Re-decompile.** Re-run `pycdc` on the new bytecode and diff `playlistparse.py` against the previous capture. The decompilation directory is gitignored research material captured at a point in time; refresh it when the upstream moves.
- **Compat-test rerun** with the new BM Loader as the read-side counterparty. Beta criterion 1 is a moving target if upstream changes its writer.
- **Codec fixture refresh.** Regenerate `src/codec/__fixtures__/` from BM Loader's new output so the parity tests are honest against the live target.
- **CHANGELOG note** under the next BMS release: "Compatibility verified against BM Loader vX.Y." Future-you will thank present-you for the timestamped pin.
- **CODEC-PARITY-AUDIT.md post-script.** That doc is already framed as historical — append a dated post-script section noting any meaningful changes rather than rewriting the original audit.

#### Before a rehearsal or live show

- **Working USB walkthrough.** Build a fresh USB from the current `main` BMS, load it on the actual BandMate hardware, verify playback on at least one song that exercises MIDI + 24-channel audio. This *is* the smoke test for the reliability principle. It's not a doc-shaped checklist; it's a habit.
- **Don't ship to USB from a feature branch.** The merge-to-main discipline exists precisely so the "what's on this stick" question has a clean answer (a commit SHA, a version tag).

#### When `git ls-files --others --exclude-standard` returns something surprising

- **Investigate before adding to `.gitignore`.** The default move ("just gitignore it") is occasionally wrong — sometimes the appearance of a new untracked file is a clue that a build step is dropping artifacts in a new location, or that a tool started writing somewhere it shouldn't. Read what the file is before you hide it.

#### Quarterly-ish architectural review

Read through `src/`, look for design-conventions drift (the four in `CLAUDE.md`), capture findings as `BACKLOG.md` entries. Doesn't have to be calendar-strict — once a season is enough.

## Phased rollout

Ordered cheapest-highest-leverage. Don't do all of this in one sitting.

### Phase H1 — CI minimum viable (~1 hour, 1 PR)

**Goal:** every PR gets gated on typecheck + tests + version-sync + CHANGELOG entry.

- New file `.github/workflows/ci.yml` running `pnpm typecheck`, `pnpm test`, the two new scripts, and `cargo check`.
- New file `scripts/check-version-sync.mjs` — reads the four version files, exits non-zero if any disagree. Print the offenders.
- New file `scripts/check-changelog-entry.mjs` — reads `package.json` version, scans `CHANGELOG.md` for a matching `## [<version>] —` header that isn't under `## [Unreleased]`. Exits non-zero if missing or unreleased.
- New `package.json` scripts: `check:versions` and `check:changelog` so the same checks run locally on demand.
- Update GitHub branch protection on `main` to require the CI workflow.
- Update `CLAUDE.md` to mention these checks under "Common commands" or "Conventions."

**Acceptance:** open a deliberately-broken PR (e.g. bump only `package.json` but not the others) and confirm CI fails. Revert.

### Phase H2 — first Routine (~30 min, 0 PRs)

**Goal:** the weekly dependency sweep is running and you've seen one cycle of its output.

- In a Code session, use `/schedule weekly dependency update sweep at <day> <time>` (e.g. Sunday 09:00).
- Refine the routine prompt at `claude.ai/code/routines`. Suggested prompt:
  > Run `pnpm outdated` and `cargo outdated` in this repo. For each minor/patch upgrade available, open a single draft PR per ecosystem (one for npm, one for cargo). Include the upgraded dep, old version, new version, and the changelog excerpt. Skip major-version upgrades — list them in the PR description under "Requires manual review" but don't upgrade them. Run `pnpm typecheck && pnpm test` after upgrading and include the result. If everything's already up to date, don't open a PR — just exit silently.
- Let it run for 2-3 weeks. Calibrate based on what comes back.

**Acceptance:** at least one draft dep-update PR has been opened by the Routine and reviewed.

### Phase H3 — backlog + doc Routines (~30 min, 0 PRs)

**Goal:** scheduled detection of backlog staleness and doc drift.

- Add the **backlog freshness** Routine (weekly).
- Add the **doc drift detection** Routine (monthly).
- Same calibration pattern as H2: run, observe, refine.

**Acceptance:** at least one draft "triage me" PR from each routine has been opened and triaged.

### Phase H4 — dead-code Routine (~15 min, 0 PRs)

**Goal:** monthly scan surfacing dead code.

- Add the **dead-code scan** Routine.

**Acceptance:** at least one draft cleanup PR from the routine has been reviewed.

### Phase H5 — pre-commit hooks (optional, ~30 min, 1 PR)

**Goal:** local catches before CI.

- Add `husky` as a dev dependency.
- Wire `pre-commit` to run `check-version-sync` and `check-changelog-entry`.
- Update `CLAUDE.md` mentioning the hook is in place.

**Acceptance:** a commit with mismatched versions is blocked locally.

### Phase H6 — release-readiness Routine (pre-Beta, ~30 min, 0 PRs)

**Goal:** one-off Routine triggered manually before each release-phase flip.

- Use `/schedule once at <release date>` (or trigger via API) to run a "release readiness" Routine that posts a checklist:
  - All Beta criteria in `docs/ROADMAP.md` accounted for?
  - Compat audit (`docs/COMPAT-TEST.md`) re-run within the last 30 days?
  - Smoke test (`docs/SMOKE-TEST.md`) run within the last 30 days?
  - Any open `[Beta blocker]` BACKLOG entries?
  - Version-files in sync? CHANGELOG complete?
- Output: an issue or draft PR with the checklist + green/red per item.

**Acceptance:** ran before the actual Beta flip; surfaced anything that would have shipped broken.

## Routines: where it fits, where it doesn't

**Fits well:**

- Layer 2 (scheduled hygiene): dependency sweeps, backlog freshness, doc drift, dead-code scans. These benefit from running while the laptop is closed, finding low-priority issues without consuming local attention, and surfacing as draft PRs you review on your own schedule.
- Layer 4 reminders (Phase H6): one-off pre-release readiness checks triggered before phase flips.

**Doesn't fit:**

- **Layer 1 (per-PR CI).** CI is the right tool here — runs on every PR with no rate limits, is free, well-understood. Routines have rate limits by plan (Pro: 5 runs/day, Max: 15/day, Team/Enterprise: 25/day) that would constrain merge throughput; if BMS dev hits 6 PRs in a day, the 6th can't get gated, which is exactly the failure mode the gate is supposed to prevent.
- **Layer 3 (pre-commit hooks).** These have to run locally on `git commit`; Routines runs in Anthropic's cloud and can't intercept a local commit.
- **Anything requiring human judgment in a UI Routines can't reach.** Manual click-throughs in BM Loader for the compat audit, hardware smoke tests on the actual BandMate device, the rehearsal-night USB walkthrough. These are Layer 4 by necessity.

**Cost note:** the full BMS hygiene Routines set above (4 weekly + 2 monthly + occasional one-offs) runs ~5 times per week in steady state — well within the per-day rate limits on any plan tier.

## Maintaining this plan itself

Re-read and update this doc:

- Before each release-phase flip (alpha → beta, beta → stable).
- When a mechanism in here stops earning its keep — e.g. a Routine becoming noisy enough to ignore. That's a signal the prompt needs tightening or the Routine should be retired, not that you should keep tolerating the noise.
- When a new debt surface emerges (a category not in "Where debt actually accumulates" above).
- When CI / Routines / pre-commit tooling itself changes underneath us.

This doc lives in `docs/` rather than `BACKLOG.md` because the work it describes is *ongoing* rather than discrete tasks. Each phase ships as one PR; subsequent maintenance of each layer happens via the layer itself (CI failures are PRs that fix them; Routines' draft PRs are PRs that get reviewed and merged; etc.).

## What this doc deliberately doesn't cover

- **Active feature planning.** Lives in [BACKLOG.md](../BACKLOG.md).
- **Release-level goals and phase criteria.** Live in [docs/ROADMAP.md](ROADMAP.md).
- **One-time cleanup phases.** Live in [docs/CLEANUP-PLAN.md](CLEANUP-PLAN.md) — when a phase completes, it doesn't move here. If the underlying *practice* recurs, it lands in a Routine (Layer 2) or a Layer 4 trigger above.
- **Per-format codec rules.** Live in [SPEC.md](../SPEC.md) and the codec source.
- **Architecture invariants.** Live in [CLAUDE.md](../CLAUDE.md).

If you find yourself wanting to document a *practice* that doesn't fit any layer above, the first question is whether the practice has a clear mechanism (CI? Routine? hook? habit?). If not, it's not actionable as hygiene — it's either a one-shot cleanup or an aspirational note.

---

Captured: 2026-05-14.
