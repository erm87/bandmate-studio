/**
 * Clean Up Unreferenced Files — confirm dialog.
 *
 * Triggered from the Song Folder tab's "Clean up…" button. Shows the
 * user exactly which `.wav` / `.mid` files in the song folder are
 * about to be deleted (because the song's `.jcs` doesn't reference
 * them), with a per-file size readout and a roll-up total.
 *
 * Reasoning for the in-app dialog (vs. a native `ask()` blocking
 * prompt): the file list is the whole point of this confirmation —
 * the user wants to scan it before agreeing to delete. `ask()`'s
 * paragraph-only body wraps badly with long filenames and provides
 * no scroll, so a real modal earns its keep.
 *
 * Safety notes encoded in the explanation copy:
 *   - Deleted files are NOT recoverable from the app — they go to
 *     the system trash via `fs::remove_file` (which on macOS uses
 *     the trash if available, but we don't make any promise here).
 *   - The Source Folder (the Logic / Pro Tools export folder the
 *     user originally imported from) is untouched. The files
 *     remain available there for re-import.
 *
 * Empty-state branch: if `files` is empty, the dialog still opens
 * — but says "Nothing to clean up" and shows only a Close button.
 * Cheaper than disabling the trigger button, and gives the user
 * positive feedback ("yep, this song's folder is already tidy").
 */

import { useEffect, useState } from "react";
import { Button } from "./Button";
import type { AudioFileInfo } from "../fs/types";
import { formatBytes } from "../lib/bytes";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Display name shown in the headline, e.g. the song's folder name. */
  songName: string;
  /**
   * Unreferenced files to be deleted. May be empty — in that case
   * the dialog shows a positive "all clean" message instead of the
   * delete UI.
   */
  files: AudioFileInfo[];
  /**
   * Invoked when the user confirms. Receives the bare filenames
   * (basenames, no path) — the parent already knows the song folder.
   * Should perform the delete + rescan + refresh and resolve / reject.
   * On reject (caught by the dialog), the error is surfaced inline
   * and the dialog stays open so the user can retry.
   */
  onConfirm: (filenames: string[]) => Promise<void>;
}

export function CleanupConfirmDialog({
  isOpen,
  onClose,
  songName,
  files,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state every time the dialog opens. Without this,
  // a previous error would persist on next open until the user typed
  // something.
  useEffect(() => {
    if (isOpen) {
      setBusy(false);
      setError(null);
    }
  }, [isOpen]);

  // Esc closes. Gated on `busy` so we don't kill an in-flight delete
  // mid-call and leave the user confused about whether it ran.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  // Sum sizes — null entries (rare: metadata read failed) contribute 0.
  const totalBytes = files.reduce(
    (acc, f) => acc + (f.sizeBytes ?? 0),
    0,
  );
  const hasFiles = files.length > 0;

  const handleConfirm = async () => {
    if (!hasFiles || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(files.map((f) => f.filename));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cleanup-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="cleanup-confirm-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {hasFiles
              ? `Clean up ${files.length} unreferenced file${files.length === 1 ? "" : "s"}`
              : "Nothing to clean up 🤠"}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="user-text">{songName}</span>
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {hasFiles ? (
            <>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                These audio and MIDI files live in the song folder but
                aren't referenced by the song's{" "}
                <span className="font-mono">.jcs</span>. Cleaning them
                removes them from this folder so the BandMate stick
                doesn't ship unused audio.
              </p>
              <p className="text-meta leading-snug text-zinc-500 dark:text-zinc-400">
                Files are deleted from the <strong>song folder</strong>{" "}
                only. Your <strong>source folder</strong> (where you
                originally imported them from) is untouched, so they
                stay available for re-import.
              </p>

              <ul className="max-h-56 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
                {files.map((f) => (
                  <li
                    key={f.filename}
                    className="flex items-baseline justify-between gap-3 py-0.5"
                  >
                    <span
                      className="user-text truncate font-mono text-xs text-zinc-700 dark:text-zinc-300"
                      title={f.filename}
                    >
                      {f.filename}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
                      {formatBytes(f.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-meta text-zinc-500 dark:text-zinc-400">
                Total to delete:{" "}
                <span className="font-mono tabular-nums">
                  {formatBytes(totalBytes)}
                </span>
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Every audio and MIDI file in this song's folder is
              referenced by the <span className="font-mono">.jcs</span>.
              Nothing to clean up.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {hasFiles ? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleConfirm}
                disabled={busy}
              >
                {busy
                  ? "Deleting…"
                  : `Delete ${files.length} file${files.length === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
