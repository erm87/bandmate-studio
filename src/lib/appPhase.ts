/**
 * Current lifecycle phase of BandMate Studio.
 *
 * Updated by hand when crossing the criteria thresholds documented
 * in `docs/VERSIONING.md`:
 *
 *   - alpha  — active development, rapid breaking changes OK,
 *              single-user (Eric + band). Current phase.
 *   - beta   — share-ready with Joe + early testers; entered when
 *              the four beta criteria are met (USB-export parity
 *              on macOS + Windows, rehearsal-validated, Windows
 *              build validated, no blocking backlog).
 *   - stable — 1.0+; entered when multiple rehearsals run cleanly
 *              + Joe's Q&A approved + no blocking backlog.
 *
 * Surfaced in the app's Settings → About panel alongside the
 * version number. Keep this constant in sync with the criteria; it
 * shouldn't be derived from the version string alone (alpha vs
 * beta both live in the 0.x range).
 */
export type AppPhase = "alpha" | "beta" | "stable";

export const APP_PHASE: AppPhase = "alpha";

/** Human-readable label for the phase, used in About-panel rendering. */
export const APP_PHASE_LABEL: Record<AppPhase, string> = {
  alpha: "Alpha",
  beta: "Beta",
  stable: "Stable",
};
