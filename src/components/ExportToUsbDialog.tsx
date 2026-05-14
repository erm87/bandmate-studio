/**
 * Export-to-USB modal — the "ship it" workflow.
 *
 * Steps:
 *   1. Pick: native folder picker for the USB mount point.
 *   2. Confirm: shows source / destination path, total size + file
 *      count, asks for explicit go-ahead.
 *   3. Copy: progress bar driven by Rust's "export-progress" events
 *      as files are copied. Runs `dot_clean -m` on macOS afterward.
 *   4. Done: success summary with an Eject button (macOS) / "you can
 *      now safely remove the drive" prompt elsewhere.
 *
 * The dialog stays modal across all four steps so the user can't
 * accidentally edit songs mid-export.
 */

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ejectVolume,
  exportToUsb,
  fileExists,
  subscribeExportProgress,
  type ExportIncludeFilter,
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

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Step = "pick" | "confirm" | "copying" | "done" | "error";

export function ExportToUsbDialog({ isOpen, onClose }: Props) {
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
    // Each candidate is validated via fileExists before pre-selecting;
    // a stale path (stick ejected) falls through to the next layer.
    const candidates = [
      { path: state.lastExportDestPath, source: "session" as const },
      {
        path: state.userPrefs.defaultExportDestPath,
        source: "settings" as const,
      },
    ];
    void (async () => {
      for (const { path, source } of candidates) {
        if (!path) continue;
        const exists = await fileExists(path);
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
  }, [
    isOpen,
    state.scan,
    state.lastExportDestPath,
    state.userPrefs.defaultExportDestPath,
    state.userPrefs.exportOnlyReferencedFiles,
    dispatch,
  ]);

  // ESC closes when not actively copying.
  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "copying") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, step, onClose]);

  const handlePickDest = async () => {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen === "string") {
      setDestPath(chosen);
      setStep("confirm");
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
      const result = await exportToUsb(workingFolder, destPath, includeFilter);
      setSummary(result);
      setStep("done");
      // Remember this destination for the rest of the session — next
      // time the dialog opens we pre-select it and skip the picker.
      dispatch({ type: "set_last_export_dest_path", path: destPath });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  const handleEject = async () => {
    if (!destPath) return;
    setEjecting(true);
    setEjectError(null);
    try {
      const ejected = await ejectVolume(destPath);
      if (!ejected) {
        // Non-macOS — show a hint instead of attempting it.
        setEjectError(
          "Auto-eject isn't supported on this OS. Eject the drive from your file manager.",
        );
        return;
      }
      onClose();
    } catch (e) {
      setEjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setEjecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        // Don't dismiss-on-backdrop while a copy is in progress —
        // would feel wrong to "lose" a running operation that way.
        if (e.target === e.currentTarget && step !== "copying") onClose();
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
              onChangeDest={() => void handlePickDest()}
              onStart={() => void handleStartExport()}
            />
          )}
          {step === "copying" && (
            <CopyingStep destPath={destPath} progress={progress} />
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
          {step === "error" && (
            <ErrorStep
              errorMsg={errorMsg}
              onRetry={() => setStep("confirm")}
              onClose={onClose}
            />
          )}
        </div>

        {step !== "copying" && step !== "done" && (
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
        Choose your BandMate USB stick to copy{" "}
        <span className="font-mono">bm_media/</span> onto.
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
      </div>

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
      <Button onClick={onStart}>Start export</Button>
    </>
  );
}

function CopyingStep({
  destPath,
  progress,
}: {
  destPath: string | null;
  progress: ExportProgress | null;
}) {
  const totalFiles = progress?.totalFiles ?? 0;
  const filesCopied = progress?.filesCopied ?? 0;
  const totalBytes = progress?.totalBytes ?? 0;
  const bytesCopied = progress?.bytesCopied ?? 0;
  const fraction =
    totalBytes > 0 ? Math.min(1, bytesCopied / totalBytes) : 0;
  const pct = Math.round(fraction * 100);

  return (
    <>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Copying to{" "}
        <span className="user-text font-mono text-xs">{destPath ?? ""}</span>…
      </p>
      <div className="space-y-1">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          aria-label="Export progress"
        >
          <div
            className="h-full bg-brand-500 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-meta tabular-nums text-zinc-500 dark:text-zinc-400">
          <span>
            {filesCopied} / {totalFiles} files
          </span>
          <span>
            {formatBytes(bytesCopied)} / {formatBytes(totalBytes)} ({pct}%)
          </span>
        </div>
      </div>
      {progress?.currentFile && (
        <p
          className="user-text truncate font-mono text-meta text-zinc-500"
          title={progress.currentFile}
        >
          {progress.currentFile}
        </p>
      )}
      <p className="text-meta leading-snug text-zinc-500 dark:text-zinc-400">
        Don't unplug the drive. The dialog will update when the copy finishes
        and macOS metadata cleanup runs.
      </p>
    </>
  );
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
  return (
    <>
      <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        Export complete — {summary.filesCopied} files (
        {formatBytes(summary.bytesCopied)}) copied to{" "}
        <span className="user-text font-mono text-xs">{destPath}</span>.
        {summary.dotCleaned &&
          " AppleDouble metadata (._*) cleaned via dot_clean."}
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
        <Button onClick={onEject} disabled={ejecting}>
          {ejecting ? "Ejecting…" : "Eject drive"}
        </Button>
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

