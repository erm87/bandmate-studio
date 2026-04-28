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
  subscribeExportProgress,
  type ExportProgress,
  type ExportSummary,
} from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";
import {
  runPreExportValidation,
  type ExportFinding,
} from "../lib/preExportValidation";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Step = "pick" | "confirm" | "copying" | "done" | "error";

export function ExportToUsbDialog({ isOpen, onClose }: Props) {
  const { state } = useAppState();
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

  // Reset every time the dialog opens. Also subscribe to progress
  // events for the lifetime of the open dialog — listeners are cheap
  // and we want to be ready before the user clicks Export.
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

    // Run pre-export validation as soon as the dialog opens, in
    // parallel with the user picking a destination — by the time
    // they confirm, findings are usually ready.
    void runPreExportValidation(state.scan)
      .then((f) => setFindings(f))
      .finally(() => setValidating(false));

    let unlisten: (() => void) | null = null;
    let cancelled = false;
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
  }, [isOpen, state.scan]);

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
      const result = await exportToUsb(workingFolder, destPath);
      setSummary(result);
      setStep("done");
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
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {step === "error" ? "Close" : "Cancel"}
            </button>
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
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Source
          </span>
          <p className="user-text font-mono">
            {workingFolder ?? "(no working folder)"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onPick}
        disabled={!workingFolder}
        className={cn(
          "rounded-md px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          workingFolder
            ? "bg-brand-500 text-white hover:bg-brand-600"
            : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
        )}
      >
        Choose USB drive…
      </button>
    </>
  );
}

function ConfirmStep({
  workingFolder,
  destPath,
  findings,
  validating,
  onChangeDest,
  onStart,
}: {
  workingFolder: string;
  destPath: string;
  findings: ExportFinding[] | null;
  validating: boolean;
  onChangeDest: () => void;
  onStart: () => void;
}) {
  return (
    <>
      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
        <div className="mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Source
          </span>
          <p className="user-text font-mono">{workingFolder}</p>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Destination
            </span>
            <p className="user-text truncate font-mono">{destPath}</p>
          </div>
          <button
            type="button"
            onClick={onChangeDest}
            className="shrink-0 self-end rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Change
          </button>
        </div>
      </div>

      {/* Pre-export findings. The export proceeds even with warnings —
          the user has explicit awareness via this section. */}
      {validating && (
        <p className="text-[11px] italic text-zinc-500 dark:text-zinc-400">
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
                  <span className="user-text block pl-3 text-[11px] opacity-80">
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

      <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
        Files in <span className="font-mono">bm_media/</span> on the working
        folder will be copied to{" "}
        <span className="font-mono">bm_media/</span> on the destination.
        Existing files at the destination are overwritten. macOS metadata
        (<span className="font-mono">.DS_Store</span>,{" "}
        <span className="font-mono">._*</span>) is stripped after the copy
        via <span className="font-mono">dot_clean</span>.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
      >
        Start export
      </button>
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
        <div className="flex justify-between text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
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
          className="user-text truncate font-mono text-[11px] text-zinc-500"
          title={progress.currentFile}
        >
          {progress.currentFile}
        </p>
      )}
      <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
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
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onEject}
          disabled={ejecting}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {ejecting ? "Ejecting…" : "Eject drive"}
        </button>
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
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
        >
          Retry
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a byte count as a short human-readable string (KB / MB / GB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
