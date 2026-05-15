/**
 * Export-to-USB modal — the "ship it" workflow.
 *
 * Steps:
 *   1. Pick: native folder picker for the USB mount point.
 *   2. Confirm: shows source / destination path, the pre-flight totals
 *      (bytes-to-copy / available / writable), and any cross-reference
 *      warnings. Surfaces inline errors (USB full, USB read-only) and
 *      keeps the user on this step until they're resolvable.
 *   3. In-progress: real-time progress bar (bytes-based), percentage,
 *      ETA from a rolling-window byte-rate sample, current file, and
 *      a Cancel button. No close-X on the dialog header during this
 *      step — the only way out is Cancel or completion.
 *   4. Terminal: Success (green check + summary footer + optional
 *      Eject), Canceled (warning + honest copy about USB state), or
 *      Error (red + remediation copy + Retry / Close).
 *
 * The dialog stays modal across all four steps so the user can't
 * accidentally edit songs mid-export.
 */

import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cancelExport,
  ejectVolume,
  exportToUsb,
  pathExists,
  prepareExport,
  subscribeExportProgress,
  type ExportIncludeFilter,
  type ExportPreFlight,
  type ExportProgress,
  type ExportSummary,
} from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import { Button } from "./Button";
import {
  runPreExportValidation,
  type ExportFinding,
} from "../lib/preExportValidation";
import {
  buildIncludeFilter,
  computeSkipSummary,
  type SkipSummary,
} from "../lib/exportFilter";
import { formatBytes } from "../lib/bytes";
import { formatDuration } from "../lib/duration";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Fired after `diskutil eject` succeeds, immediately before the
   * dialog closes. Lets the parent render a confirmation toast on
   * the editor pane — the dialog itself unmounts on close so a
   * toast owned here wouldn't be visible long enough to read.
   */
  onEjected?: () => void;
}

type Step =
  | "pick"
  | "confirm"
  | "copying"
  | "canceling"
  | "done"
  | "ejecting"
  | "canceled"
  | "error";

/**
 * Safety margin for the free-space check. The reported `availableBytes`
 * from sysinfo can drift by a small amount during the export (FAT
 * cluster overhead, exFAT metadata, OS-side caches), so we add a
 * 10 MB cushion before declaring "not enough space." Matches the
 * margin recommended in the BACKLOG entry.
 */
const FREE_SPACE_MARGIN_BYTES = 10 * 1024 * 1024;

export function ExportToUsbDialog({ isOpen, onClose, onEjected }: Props) {
  const { state, dispatch } = useAppState();
  const workingFolder = state.workingFolder;

  const [step, setStep] = useState<Step>("pick");
  const [destPath, setDestPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ejecting, setEjecting] = useState(false);
  const [ejectError, setEjectError] = useState<string | null>(null);
  const [findings, setFindings] = useState<ExportFinding[] | null>(null);
  const [validating, setValidating] = useState(false);
  /**
   * Filter sent to the Rust export when `exportOnlyReferencedFiles`
   * is on. `null` means full-copy (the historical behavior). Computed
   * on dialog open in parallel with the playlist validation.
   */
  const [includeFilter, setIncludeFilter] =
    useState<ExportIncludeFilter | null>(null);
  /**
   * Per-song skip totals + zero-files warnings, surfaced in the
   * confirm step under the source/destination panel. `null` when
   * the toggle is off or while we're still computing.
   */
  const [skipSummary, setSkipSummary] = useState<SkipSummary | null>(null);
  /**
   * Pre-flight result, populated by `prepareExport` when the user
   * lands on the Confirm step (or changes destination). `null` while
   * we're still checking; an inline error renders if the destination
   * isn't writable or doesn't have enough room.
   */
  const [preFlight, setPreFlight] = useState<ExportPreFlight | null>(null);
  const [preFlightError, setPreFlightError] = useState<string | null>(null);

  // Refs capture session/persistent destination hints WITHOUT letting
  // their updates retrigger the init effect. The previous shape — with
  // `state.lastExportDestPath` in the effect dep array — caused a
  // post-success state reset: handleStartExport dispatches
  // `set_last_export_dest_path` on success, which changed the dep,
  // which re-ran init (setStep("pick"), reset everything), masking
  // the Success terminal state entirely. The init effect now only
  // depends on `isOpen` for the reset/listener subscription, and
  // reads candidates through these refs at run time.
  const lastExportDestPathRef = useRef(state.lastExportDestPath);
  lastExportDestPathRef.current = state.lastExportDestPath;
  const defaultExportDestPathRef = useRef(state.userPrefs.defaultExportDestPath);
  defaultExportDestPathRef.current = state.userPrefs.defaultExportDestPath;

  // Reset every time the dialog opens. Also subscribe to progress
  // events for the lifetime of the open dialog — listeners are cheap
  // and we want to be ready before the user clicks Export.
  //
  // Destination resolution: try session memory (`lastExportDestPath`)
  // first. If the path still exists, pre-select it and jump straight
  // to the "confirm" step — skipping the picker is the whole win for
  // export → fix → re-export iteration loops. If the path no longer
  // exists (USB stick ejected between exports) or there's no session
  // memory, fall through to the standard "pick" step.
  useEffect(() => {
    if (!isOpen) return;
    setStep("pick");
    setDestPath(null);
    setProgress(null);
    setSummary(null);
    setErrorMsg(null);
    setEjecting(false);
    setEjectError(null);
    setFindings(null);
    setValidating(true);
    setIncludeFilter(null);
    setSkipSummary(null);
    setPreFlight(null);
    setPreFlightError(null);

    // Run pre-export validation + (if the toggle is on) the include-
    // filter build and skip-summary inspection. All in parallel — by
    // the time the user clicks through to Confirm, totals are ready.
    //
    // The skip summary depends on the include filter being ready
    // (it uses the same per-song allow-list to classify each folder's
    // files), so we chain those two. Validation runs independently.
    const wantsFilter = state.userPrefs.exportOnlyReferencedFiles;
    void runPreExportValidation(state.scan).then((baseFindings) => {
      // Zero-media warnings get folded into the same findings list
      // shown in the confirm step's amber block — they're real
      // export-time warnings.
      if (!wantsFilter) {
        setFindings(baseFindings);
        setValidating(false);
        return;
      }
      void buildIncludeFilter(state.scan).then(async (filter) => {
        setIncludeFilter(filter);
        const summary = await computeSkipSummary(state.scan, filter);
        setSkipSummary(summary);
        const zeroFindings: ExportFinding[] = summary.songsWithZeroFiles.map(
          (songName) => ({
            severity: "warning",
            message: `Song "${songName}" has no media files referenced — it will export with audio missing.`,
            detail:
              "The .jcs still ships, but the BandMate won't have audio for this song. Open the song and assign files, or remove the song.",
          }),
        );
        setFindings([...baseFindings, ...zeroFindings]);
        setValidating(false);
      });
    });

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    // Pre-select a destination if we have one to suggest. Resolution
    // order:
    //   1. Session memory (`state.lastExportDestPath`) — set after a
    //      successful export this session. Wins because it reflects
    //      the most recent EXPLICIT user choice.
    //   2. Persistent default (`userPrefs.defaultExportDestPath`) —
    //      the user's sticky preference from Settings.
    //   3. Fall through to the "pick" step (today's behavior).
    // Each candidate is validated via pathExists before pre-selecting;
    // a stale path (stick ejected) falls through to the next layer.
    const candidates = [
      { path: lastExportDestPathRef.current, source: "session" as const },
      {
        path: defaultExportDestPathRef.current,
        source: "settings" as const,
      },
    ];
    void (async () => {
      for (const { path, source } of candidates) {
        if (!path) continue;
        const exists = await pathExists(path);
        if (cancelled) return;
        if (exists) {
          setDestPath(path);
          setStep("confirm");
          return;
        }
        // Stale session-memory path — clear it so the next attempt
        // skips this layer. Don't auto-clear the persistent default
        // (the user explicitly set it; preserve their preference even
        // if the stick happens to be unplugged right now).
        if (source === "session") {
          dispatch({ type: "set_last_export_dest_path", path: null });
        }
      }
    })();

    void subscribeExportProgress((p) => {
      if (cancelled) return;
      setProgress(p);
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // Dep list is deliberately minimal: only `isOpen` (toggle open
    // vs closed) plus dispatch + the prefs that meaningfully alter
    // what we're about to compute (scan, filter pref). Destination
    // hints come through refs — see comment above the refs for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    state.scan,
    state.userPrefs.exportOnlyReferencedFiles,
    dispatch,
  ]);

  // Re-run pre-flight whenever the user lands on the Confirm step
  // with a destination + working folder, OR changes the destination.
  // Pre-flight is cheap-ish (count_tree walk + a probe write); keep
  // the user informed and don't surprise them with a "USB is full"
  // error after they've already clicked Start.
  //
  // Note: the include filter is awaited via the same dialog-open
  // effect above. Pre-flight passes whatever filter is in state at
  // call time — if the filter is still being computed (filter pref
  // on, filter null), we re-run when it settles.
  useEffect(() => {
    if (!isOpen) return;
    if (step !== "confirm") return;
    if (!workingFolder || !destPath) return;
    // If the filter is enabled but not yet computed, wait. The
    // includeFilter effect dep below re-runs us when it lands.
    if (state.userPrefs.exportOnlyReferencedFiles && includeFilter === null) {
      return;
    }
    let cancelled = false;
    setPreFlight(null);
    setPreFlightError(null);
    void prepareExport(workingFolder, destPath, includeFilter)
      .then((res) => {
        if (!cancelled) setPreFlight(res);
      })
      .catch((e) => {
        if (!cancelled) {
          setPreFlightError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    step,
    workingFolder,
    destPath,
    includeFilter,
    state.userPrefs.exportOnlyReferencedFiles,
  ]);

  // ESC closes when not actively copying / canceling / ejecting.
  // The terminal states (done / canceled / error) also accept ESC
  // — same as clicking Close / Done.
  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (step === "copying" || step === "canceling" || step === "ejecting") {
        return;
      }
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, step, onClose]);

  const handlePickDest = async () => {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen === "string") {
      setDestPath(chosen);
      setStep("confirm");
      // Remember the destination as soon as the user picks it — not
      // just after a successful export. Otherwise a partial session
      // (user picks a stick, then closes the dialog before clicking
      // Start) wouldn't pre-select on the next open, which is the
      // common iteration loop. The destination still gets validated
      // via pathExists on subsequent opens, so a path that's no
      // longer mounted falls through to the picker.
      dispatch({ type: "set_last_export_dest_path", path: chosen });
    }
  };

  const handleStartExport = async () => {
    if (!workingFolder || !destPath) return;
    setStep("copying");
    setProgress(null);
    try {
      // includeFilter is non-null only when the user pref is on AND
      // the buildIncludeFilter call already returned. If the user
      // somehow clicks Start before the filter resolves, Rust will
      // do a full-copy — acceptable fallback.
      const result = await exportToUsb(
        workingFolder,
        destPath,
        includeFilter,
        state.exportIncrementalOnly,
      );
      setSummary(result);
      if (result.wasCanceled) {
        setStep("canceled");
      } else {
        setStep("done");
        // (The destination was already remembered at pick-time via
        // handlePickDest, so no dispatch is needed here.)
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  const handleCancelExport = async () => {
    setStep("canceling");
    try {
      await cancelExport();
    } catch {
      // Best-effort. The export will still try to halt at the next
      // file boundary even if the IPC errored on its way out.
    }
  };

  const handleEject = async () => {
    if (!destPath) return;
    setEjecting(true);
    setEjectError(null);
    setStep("ejecting");
    try {
      const ejected = await ejectVolume(destPath);
      if (!ejected) {
        // Non-macOS — show a hint instead of attempting it.
        setEjectError(
          "Auto-eject isn't supported on this OS. Eject the drive from your file manager.",
        );
        setStep("done");
        return;
      }
      // Signal the parent so it can render a confirmation toast on
      // the editor pane — once we call onClose the dialog unmounts,
      // and a toast owned in here would unmount with it.
      onEjected?.();
      onClose();
    } catch (e) {
      setEjectError(e instanceof Error ? e.message : String(e));
      setStep("done");
    } finally {
      setEjecting(false);
    }
  };

  if (!isOpen) return null;

  // Pre-flight blocking conditions surfaced as inline errors on
  // Confirm. Derived rather than stored so they recompute when the
  // pre-flight result lands. The free-space check uses whichever
  // total reflects what's actually about to be written — full or
  // incremental — so an incremental export against a near-full USB
  // isn't blocked unnecessarily when the small delta would fit.
  const notWritable = preFlight !== null && !preFlight.isWritable;
  const bytesToWrite =
    preFlight === null
      ? 0
      : state.exportIncrementalOnly
        ? preFlight.incrementalBytes
        : preFlight.totalBytes;
  const notEnoughSpace =
    preFlight !== null &&
    preFlight.availableBytes > 0 &&
    bytesToWrite + FREE_SPACE_MARGIN_BYTES > preFlight.availableBytes;
  const canStartExport =
    preFlight !== null && !notWritable && !notEnoughSpace && !validating;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        // Don't dismiss-on-backdrop while a copy / cancel / eject is
        // in progress — would feel wrong to "lose" a running
        // operation that way. Terminal states (done/canceled/error)
        // dismiss normally.
        if (
          e.target === e.currentTarget &&
          step !== "copying" &&
          step !== "canceling" &&
          step !== "ejecting"
        )
          onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="export-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            Export to USB
          </h2>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          {step === "pick" && (
            <PickStep
              workingFolder={workingFolder}
              onPick={() => void handlePickDest()}
            />
          )}
          {step === "confirm" && destPath && workingFolder && (
            <ConfirmStep
              workingFolder={workingFolder}
              destPath={destPath}
              findings={findings}
              validating={validating}
              skipSummary={skipSummary}
              filterOn={state.userPrefs.exportOnlyReferencedFiles}
              preFlight={preFlight}
              preFlightError={preFlightError}
              notWritable={notWritable}
              notEnoughSpace={notEnoughSpace}
              canStart={canStartExport}
              incremental={state.exportIncrementalOnly}
              onToggleIncremental={(value) =>
                dispatch({ type: "set_export_incremental_only", value })
              }
              onChangeDest={() => void handlePickDest()}
              onStart={() => void handleStartExport()}
            />
          )}
          {step === "copying" && (
            <CopyingStep
              destPath={destPath}
              progress={progress}
              onCancel={() => void handleCancelExport()}
            />
          )}
          {step === "canceling" && (
            <CancelingStep destPath={destPath} progress={progress} />
          )}
          {step === "done" && summary && destPath && (
            <DoneStep
              destPath={destPath}
              summary={summary}
              ejecting={ejecting}
              ejectError={ejectError}
              onEject={() => void handleEject()}
              onClose={onClose}
            />
          )}
          {step === "ejecting" && destPath && (
            <EjectingStep destPath={destPath} />
          )}
          {step === "canceled" && summary && destPath && (
            <CanceledStep
              destPath={destPath}
              summary={summary}
              onClose={onClose}
            />
          )}
          {step === "error" && (
            <ErrorStep
              errorMsg={errorMsg}
              onRetry={() => setStep("confirm")}
              onClose={onClose}
            />
          )}
        </div>

        {/* Footer: a single Cancel/Close affordance that's
            CONTEXT-AWARE — present on every step except the
            in-progress copying / canceling states (where the only
            way out is the in-body Cancel button) and the Done /
            Canceled states (where the in-body Close / Eject are the
            primary affordances). */}
        {step !== "copying" &&
          step !== "canceling" &&
          step !== "ejecting" &&
          step !== "done" &&
          step !== "canceled" && (
            <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <Button variant="ghost" onClick={onClose}>
                {step === "error" ? "Close" : "Cancel"}
              </Button>
            </footer>
          )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-step views
// ---------------------------------------------------------------------------

function PickStep({
  workingFolder,
  onPick,
}: {
  workingFolder: string | null;
  onPick: () => void;
}) {
  return (
    <>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Choose the USB stick to export your songs and playlists onto.
        This will be the USB stick you plug into the BandMate unit for
        playback.
      </p>
      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
        <div>
          <span className="eyebrow">
            Source
          </span>
          <p className="user-text font-mono">
            {workingFolder ?? "(no working folder)"}
          </p>
        </div>
      </div>
      <Button onClick={onPick} disabled={!workingFolder}>
        Choose USB drive…
      </Button>
    </>
  );
}

function ConfirmStep({
  workingFolder,
  destPath,
  findings,
  validating,
  skipSummary,
  filterOn,
  preFlight,
  preFlightError,
  notWritable,
  notEnoughSpace,
  canStart,
  incremental,
  onToggleIncremental,
  onChangeDest,
  onStart,
}: {
  workingFolder: string;
  destPath: string;
  findings: ExportFinding[] | null;
  validating: boolean;
  /**
   * Skip totals when the `exportOnlyReferencedFiles` pref is on. Null
   * while computing OR when the pref is off (`filterOn` distinguishes).
   */
  skipSummary: SkipSummary | null;
  /** Whether the "only referenced files" toggle is currently on. */
  filterOn: boolean;
  /** Pre-flight result; null while still running. */
  preFlight: ExportPreFlight | null;
  preFlightError: string | null;
  notWritable: boolean;
  notEnoughSpace: boolean;
  canStart: boolean;
  /**
   * Whether the "Export updates only" checkbox is checked. Drives
   * the visual emphasis of the incremental-total line and is passed
   * down to Rust as the `incremental` flag on Start.
   */
  incremental: boolean;
  onToggleIncremental: (value: boolean) => void;
  onChangeDest: () => void;
  onStart: () => void;
}) {
  return (
    <>
      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
        <div className="mb-2">
          <span className="eyebrow">
            Source
          </span>
          <p className="user-text font-mono">{workingFolder}</p>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="eyebrow">
              Destination
            </span>
            <p className="user-text truncate font-mono">{destPath}</p>
          </div>
          <Button
            variant="tertiary"
            onClick={onChangeDest}
            className="shrink-0 self-end"
          >
            Change
          </Button>
        </div>
        {/* Pre-flight totals — both full and incremental are shown
            simultaneously so the user can see "what a full export
            would do" alongside "what an incremental would actually
            copy." The line corresponding to the active mode (driven
            by the Export-updates-only checkbox below) is rendered
            in stronger weight; the other reads as informational. */}
        {preFlight && (
          <div className="mt-2 border-t border-zinc-200 pt-2 font-mono tabular-nums dark:border-zinc-800">
            <div className={incremental ? "opacity-60" : "font-semibold"}>
              Full:{" "}
              {preFlight.totalFiles}{" "}
              {preFlight.totalFiles === 1 ? "file" : "files"},{" "}
              {formatBytes(preFlight.totalBytes)}
            </div>
            <div className={incremental ? "font-semibold" : "opacity-60"}>
              Updates only:{" "}
              {preFlight.incrementalFiles}{" "}
              {preFlight.incrementalFiles === 1 ? "file" : "files"},{" "}
              {formatBytes(preFlight.incrementalBytes)}
            </div>
            {preFlight.availableBytes > 0 && (
              <div className="mt-1 opacity-70">
                {formatBytes(preFlight.availableBytes)} free on USB
              </div>
            )}
          </div>
        )}
      </div>

      {/* "Export updates only" toggle. Session-sticky via AppState;
          tooltip on the help glyph explains the trade-off. Default
          is off so a fresh session lands on the safer full-rewrite
          behavior. */}
      <label className="flex cursor-pointer items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={incremental}
          onChange={(e) => onToggleIncremental(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-brand-500"
        />
        <span className="select-none">Export updates only</span>
        <span
          className="ml-auto inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
          // Native browser tooltip — discoverable on hover, no extra
          // popover component needed for this one affordance.
          title="Skips files already on the USB whose size and modification time match the working folder. Much faster for repeat exports. Updated files (including same-name replacements) are always re-copied — any content change updates the file's modification time. Turn off if you want a guaranteed full re-write."
          aria-label="What does Export updates only do?"
        >
          ?
        </span>
      </label>

      {/* "Only referenced files" filter status — neutral info, not a
          warning. Shows the running skip total once computed. */}
      {filterOn && (
        <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          <span className="eyebrow">Filter</span>
          {skipSummary === null ? (
            <p className="italic">
              Computing which files are referenced…
            </p>
          ) : skipSummary.fileCount === 0 ? (
            <p>
              All files in song folders are referenced — nothing extra
              to skip.
            </p>
          ) : (
            <p>
              Skipping {skipSummary.fileCount} unused file
              {skipSummary.fileCount === 1 ? "" : "s"} (~
              {formatBytes(skipSummary.byteCount)}) that no song's{" "}
              <span className="font-mono">.jcs</span> references.
            </p>
          )}
        </div>
      )}

      {/* Pre-flight failure modes — hard blocks. Shown as red so they
          read as "must fix before Start." */}
      {preFlightError !== null && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          Couldn't check the USB: {preFlightError}
        </p>
      )}
      {notWritable && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          USB is read-only — Studio couldn't write a probe file at the
          destination. Check the stick's lock switch or re-format if
          this isn't intended.
        </p>
      )}
      {notEnoughSpace && preFlight && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          USB is too full — export needs{" "}
          {formatBytes(
            incremental
              ? preFlight.incrementalBytes
              : preFlight.totalBytes,
          )}{" "}
          but only {formatBytes(preFlight.availableBytes)} is free. Free
          some space on the stick or pick a different drive.
        </p>
      )}

      {/* Pre-export findings. The export proceeds even with warnings —
          the user has explicit awareness via this section. */}
      {validating && (
        <p className="text-meta italic text-zinc-500 dark:text-zinc-400">
          Checking references…
        </p>
      )}
      {!validating && findings && findings.length > 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="mb-1 font-semibold">
            {findings.length} {findings.length === 1 ? "warning" : "warnings"}
            {" — export will still run, BandMate skips broken references."}
          </p>
          <ul className="space-y-0.5">
            {findings.map((f, i) => (
              <li key={i}>
                <span className="user-text">{f.message}</span>
                {f.detail && (
                  <span className="user-text block pl-3 text-meta opacity-80">
                    {f.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!validating && findings && findings.length === 0 && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          All playlist references resolve. Ready to export.
        </p>
      )}

      <p className="text-meta leading-snug text-zinc-500 dark:text-zinc-400">
        Files in <span className="font-mono">bm_media/</span> on the working
        folder will be copied to{" "}
        <span className="font-mono">bm_media/</span> on the destination.
        Existing files at the destination are overwritten. macOS metadata
        (<span className="font-mono">.DS_Store</span>,{" "}
        <span className="font-mono">._*</span>) is stripped after the copy
        via <span className="font-mono">dot_clean</span>.
      </p>
      <Button onClick={onStart} disabled={!canStart}>
        {preFlight === null && preFlightError === null
          ? "Checking USB…"
          : "Start export"}
      </Button>
    </>
  );
}

/**
 * Format an ETA in seconds as a human-readable phrase. Uses round
 * units (≥1m → "About N minutes"; <1m → "About N seconds") rather
 * than `m:ss` because exports are long enough that second-level
 * precision is noise — the user wants to know whether to wait a
 * minute or grab a coffee, not down-to-the-second.
 */
function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) {
    if (s < 5) return "Less than 5 seconds remaining";
    return `About ${s} seconds remaining`;
  }
  const m = Math.round(s / 60);
  return `About ${m} ${m === 1 ? "minute" : "minutes"} remaining`;
}

function CopyingStep({
  destPath,
  progress,
  onCancel,
}: {
  destPath: string | null;
  progress: ExportProgress | null;
  onCancel: () => void;
}) {
  const totalFiles = progress?.totalFiles ?? 0;
  const filesCopied = progress?.filesCopied ?? 0;
  const totalBytes = progress?.totalBytes ?? 0;
  const bytesCopied = progress?.bytesCopied ?? 0;
  const fraction = totalBytes > 0 ? Math.min(1, bytesCopied / totalBytes) : 0;
  const pct = Math.round(fraction * 100);

  // Rolling sample window for ETA. We hold the last ~5 seconds of
  // (timestamp, bytesCopied) pairs and compute a byte/sec rate from
  // the oldest vs the newest sample. The first second is unreliable
  // (USB cache warming) so we suppress the ETA below 3 seconds or
  // 5% — whichever comes first.
  const startRef = useRef<number | null>(null);
  const samplesRef = useRef<{ t: number; bytes: number }[]>([]);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (bytesCopied === 0 && totalBytes === 0) return;
    const now = performance.now();
    if (startRef.current === null) startRef.current = now;
    const samples = samplesRef.current;
    samples.push({ t: now, bytes: bytesCopied });
    // Trim anything older than 5s from the window.
    while (samples.length > 1 && now - samples[0]!.t > 5000) {
      samples.shift();
    }
    const elapsedFromStart = now - (startRef.current ?? now);
    const ready =
      elapsedFromStart >= 3000 ||
      (totalBytes > 0 && bytesCopied / totalBytes >= 0.05);
    if (!ready || samples.length < 2) {
      setEtaSeconds(null);
      return;
    }
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const dt = (last.t - first.t) / 1000;
    const dBytes = last.bytes - first.bytes;
    if (dt <= 0 || dBytes <= 0) {
      setEtaSeconds(null);
      return;
    }
    const rate = dBytes / dt; // bytes/sec
    const remaining = Math.max(0, totalBytes - bytesCopied);
    setEtaSeconds(remaining / rate);
  }, [bytesCopied, totalBytes]);

  const etaLabel =
    etaSeconds === null ? "Calculating…" : formatEta(etaSeconds);

  return (
    <>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Copying to{" "}
        <span className="user-text font-mono text-xs">{destPath ?? ""}</span>…
      </p>
      <div className="space-y-1">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Export progress"
        >
          <div
            className="h-full bg-brand-500 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-meta tabular-nums text-zinc-500 dark:text-zinc-400">
          <span>{etaLabel}</span>
          <span>
            {formatBytes(bytesCopied)} / {formatBytes(totalBytes)} ({pct}%)
          </span>
        </div>
        <div className="flex justify-between text-meta tabular-nums text-zinc-500 dark:text-zinc-400">
          <span>
            {filesCopied} / {totalFiles} files
          </span>
        </div>
      </div>
      {progress?.currentFile && (
        <p
          className="user-text truncate font-mono text-meta text-zinc-500"
          title={progress.currentFile}
        >
          Copying: {progress.currentFile}
        </p>
      )}
      <p className="text-meta leading-snug text-zinc-500 dark:text-zinc-400">
        Don't unplug the drive. The dialog will update when the copy finishes
        and macOS metadata cleanup runs.
      </p>
      <div className="flex items-center justify-end pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function CancelingStep({
  destPath,
  progress,
}: {
  destPath: string | null;
  progress: ExportProgress | null;
}) {
  const filesCopied = progress?.filesCopied ?? 0;
  return (
    <>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Canceling export…
      </p>
      <p className="text-meta leading-snug text-zinc-500 dark:text-zinc-400">
        Finishing the file currently in progress, then stopping. The
        dialog will update in a moment with what landed on{" "}
        <span className="user-text font-mono text-xs">{destPath ?? ""}</span>.
        {filesCopied > 0 && (
          <>
            {" "}
            ({filesCopied} {filesCopied === 1 ? "file" : "files"} written so
            far.)
          </>
        )}
      </p>
    </>
  );
}

/**
 * Pluralizer for the added/updated breakdown lines. "1 song added, 0
 * songs updated" reads better than "1 songs added"; for zero counts
 * we just omit the side of the breakdown rather than say "0 songs
 * updated." Skip the line entirely when both counts are zero
 * (filter ran past that category, or the export was canceled before
 * touching anything in it).
 */
function breakdownLine(
  singular: string,
  plural: string,
  added: number,
  updated: number,
): string | null {
  if (added === 0 && updated === 0) return null;
  const parts: string[] = [];
  if (added > 0) {
    parts.push(`${added} ${added === 1 ? singular : plural} added`);
  }
  if (updated > 0) {
    parts.push(`${updated} ${updated === 1 ? singular : plural} updated`);
  }
  return parts.join(", ");
}

function DoneStep({
  destPath,
  summary,
  ejecting,
  ejectError,
  onEject,
  onClose,
}: {
  destPath: string;
  summary: ExportSummary;
  ejecting: boolean;
  ejectError: string | null;
  onEject: () => void;
  onClose: () => void;
}) {
  const songsLine = breakdownLine(
    "song",
    "songs",
    summary.songsAdded,
    summary.songsUpdated,
  );
  const playlistsLine = breakdownLine(
    "playlist",
    "playlists",
    summary.playlistsAdded,
    summary.playlistsUpdated,
  );
  const trackmapsLine = breakdownLine(
    "track map",
    "track maps",
    summary.trackmapsAdded,
    summary.trackmapsUpdated,
  );
  // Only surface the "unchanged" line when the export ran with
  // incremental mode on — full exports rewrite every file by
  // design, so an "N unchanged" line would be misleading (it'd
  // always be 0 in full mode).
  const unchangedLine =
    summary.wasIncremental && summary.filesUnchanged > 0
      ? `${summary.filesUnchanged} ${summary.filesUnchanged === 1 ? "file" : "files"} unchanged (skipped)`
      : null;
  const breakdown = [
    songsLine,
    playlistsLine,
    trackmapsLine,
    unchangedLine,
  ].filter((l): l is string => l !== null);
  return (
    <>
      <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <p className="font-semibold">Export complete.</p>
        {breakdown.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs">
            {breakdown.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs">
          {formatBytes(summary.bytesCopied)} copied to{" "}
          <span className="user-text font-mono">{destPath}</span> in{" "}
          {formatDuration(summary.elapsedMs / 1000)}.
          {summary.dotCleaned && " macOS metadata stripped via dot_clean."}
        </p>
      </div>
      {ejectError && (
        <p
          role="alert"
          className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {ejectError}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
        <Button
          onClick={onEject}
          disabled={ejecting || !summary.isEjectable}
          // `title` on a disabled button still surfaces via the
          // browser's native tooltip on hover — keeps the
          // remediation copy discoverable without a custom tooltip
          // component just for this one case.
          title={
            !summary.isEjectable
              ? "Eject only applies to removable volumes (USB sticks, SD cards). The chosen destination isn't ejectable."
              : ejecting
                ? "Ejecting…"
                : undefined
          }
        >
          {ejecting ? "Ejecting…" : "Eject drive"}
        </Button>
      </div>
    </>
  );
}

/**
 * Indeterminate "Ejecting…" state. macOS `diskutil eject` can take
 * a few seconds while pending writes flush; without a designed-in
 * indicator the user sees the OS beachball and assumes the app
 * froze. Apple HIG: indeterminate spinner + context line for tasks
 * of unknown short duration; no interactive elements during the
 * operation (eject can't be cleanly canceled). Closes the dialog
 * on success (the existing `onClose` path in `handleEject`).
 */
function EjectingStep({ destPath }: { destPath: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <Spinner className="h-8 w-8 text-brand-500" />
      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Ejecting USB drive…
        </p>
        <p className="mt-1 text-meta leading-snug text-zinc-500 dark:text-zinc-400">
          macOS is flushing any remaining writes to{" "}
          <span className="user-text font-mono">{destPath}</span>. This
          usually takes a few seconds.
        </p>
      </div>
    </div>
  );
}

/**
 * Indeterminate spinner glyph. Two-stop circle (light track + dark
 * arc) rotated via Tailwind's `animate-spin`. Standard pattern used
 * across the design system — keep visually consistent with other
 * "working on it" affordances.
 */
function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Working"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CanceledStep({
  destPath,
  summary,
  onClose,
}: {
  destPath: string;
  summary: ExportSummary;
  onClose: () => void;
}) {
  return (
    <>
      <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-semibold">Export canceled.</p>
        <p className="mt-1 text-xs">
          {summary.filesCopied} of {summary.totalFiles}{" "}
          {summary.totalFiles === 1 ? "file" : "files"} (
          {formatBytes(summary.bytesCopied)} of{" "}
          {formatBytes(summary.totalBytes)}) were written to{" "}
          <span className="user-text font-mono">{destPath}</span> before
          stopping. The stick may be in an inconsistent state — re-run the
          export to fully sync, or restore from backup.
        </p>
      </div>
      <div className="flex items-center justify-end pt-1">
        <Button onClick={onClose}>Close</Button>
      </div>
    </>
  );
}

function ErrorStep({
  errorMsg,
  onRetry,
  onClose,
}: {
  errorMsg: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        Export failed: {errorMsg ?? "unknown error"}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    </>
  );
}
