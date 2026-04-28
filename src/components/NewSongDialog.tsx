/**
 * New Song wizard — modal dialog.
 *
 * Three inputs:
 *   1. Song name (becomes the folder name + .jcs filename — BandMate's
 *      naming convention)
 *   2. Sample rate (44.1 / 48 kHz, segmented control)
 *   3. Source folder (optional) — where unimported WAVs live; persisted
 *      to the song's `.bandmate-studio.json` sidecar
 *
 * On Create, the dialog:
 *   - Calls Rust `create_song` to make the folder
 *   - Writes an empty .jcs via the codec
 *   - Writes the sidecar (only if a source folder was chosen)
 *   - Triggers a working-folder rescan
 *   - Dispatches `select` so the editor opens on the new song
 *
 * Validation strategy: live name validator that mirrors the Rust rules
 * (non-empty, ≤64 chars, no leading dot, no slashes) plus a
 * collision check against the already-scanned songs list. Surfaces
 * inline so the Create button stays disabled until everything is
 * resolved.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createEmptySong, writeSong } from "../codec";
import {
  createSong,
  writeSongSidecar,
  writeTextFile,
} from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Mirrors the Rust validator in `create_song`. */
function validateName(
  name: string,
  existingFolderNames: Set<string>,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name is required.";
  if (trimmed.length > 64) return "Name is too long (max 64 characters).";
  if (trimmed.startsWith(".")) return "Name cannot start with a dot.";
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Name cannot contain '/' or '\\'.";
  }
  if (existingFolderNames.has(trimmed)) {
    return `A song named "${trimmed}" already exists.`;
  }
  return null;
}

export function NewSongDialog({ isOpen, onClose }: Props) {
  const { state, dispatch, rescan } = useAppState();

  const [name, setName] = useState("");
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100);
  const [sourceFolder, setSourceFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the dialog opens. Done via key prop on the
  // dialog body or here — we do it here so the reset is observable
  // for any side effects (e.g., autofocus).
  useEffect(() => {
    if (isOpen) {
      setName("");
      setSampleRate(44100);
      setSourceFolder(null);
      setCreating(false);
      setCreateError(null);
      // Autofocus the name input on open. requestAnimationFrame so the
      // input exists in the DOM by the time we ask for focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // ESC closes the dialog (unless we're mid-create — don't surprise
  // the user by aborting an in-flight FS write).
  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, creating, onClose]);

  const existingFolderNames = useMemo(
    () => new Set(state.scan.songs.map((s) => s.folderName)),
    [state.scan.songs],
  );

  const validationError = validateName(name, existingFolderNames);
  // Show the validation error only after the user has typed at least
  // one character — pristine empty field shouldn't shout at them.
  const showValidationError = name.length > 0 && validationError !== null;
  const canCreate =
    !creating && validationError === null && state.workingFolder !== null;

  const handlePickSourceFolder = async () => {
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string") {
      setSourceFolder(result);
    }
  };

  const handleCreate = async () => {
    if (!canCreate || !state.workingFolder) return;
    setCreating(true);
    setCreateError(null);
    try {
      // 1. Create the empty folder.
      const created = await createSong(state.workingFolder, name.trim());
      // 2. Write an empty .jcs in it.
      const emptySong = createEmptySong(sampleRate);
      await writeTextFile(created.jcsPath, writeSong(emptySong));
      // 3. If they picked a source folder, persist it via sidecar.
      if (sourceFolder) {
        await writeSongSidecar(created.folderPath, { sourceFolder });
      }
      // 4. Refresh the sidebar so the new song appears.
      await rescan();
      // 5. Auto-open the new song in the editor.
      dispatch({
        type: "select",
        selection: { kind: "song", jcsPath: created.jcsPath },
      });
      // 6. Dismiss.
      onClose();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-song-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        // Clicking the backdrop dismisses, but only outside the panel
        // and only when not mid-create.
        if (e.target === e.currentTarget && !creating) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="new-song-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            New Song
          </h2>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Name
            </span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Song"
              maxLength={64}
              disabled={creating}
              className={cn(
                "user-text rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:ring-2 dark:bg-zinc-950",
                showValidationError
                  ? "border-red-300 focus-visible:ring-red-400 dark:border-red-700"
                  : "border-zinc-300 focus-visible:ring-brand-400 dark:border-zinc-700",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
            {showValidationError && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {validationError}
              </span>
            )}
            <span className="text-[11px] text-zinc-500">
              Becomes the song folder name and the .jcs filename.
            </span>
          </label>

          {/* Sample rate */}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Sample Rate
            </legend>
            <div className="inline-flex w-fit overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
              <RateButton
                label="44.1 kHz"
                isActive={sampleRate === 44100}
                onClick={() => setSampleRate(44100)}
                disabled={creating}
              />
              <span
                aria-hidden="true"
                className="w-px self-stretch bg-zinc-300 dark:bg-zinc-700"
              />
              <RateButton
                label="48 kHz"
                isActive={sampleRate === 48000}
                onClick={() => setSampleRate(48000)}
                disabled={creating}
              />
            </div>
          </fieldset>

          {/* Source folder */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Source Folder <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={handlePickSourceFolder}
                disabled={creating}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                {sourceFolder ? "Change…" : "Choose folder…"}
              </button>
              <span
                className="user-text flex-1 truncate self-center font-mono text-xs text-zinc-600 dark:text-zinc-400"
                title={sourceFolder ?? ""}
              >
                {sourceFolder ?? "No source folder selected"}
              </span>
            </div>
            <span className="text-[11px] text-zinc-500">
              Where your unimported WAVs live (e.g., a Logic export folder).
              Files appear in the song editor's source pane and copy
              into the song folder when you save.
            </span>
          </div>

          {createError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {createError}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
              canCreate
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
            )}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function RateButton({
  label,
  isActive,
  onClick,
  disabled,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-3 py-1.5 font-mono text-xs transition disabled:opacity-50",
        isActive
          ? "bg-brand-500 text-white"
          : "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900",
      )}
    >
      {label}
    </button>
  );
}
