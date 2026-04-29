/**
 * New Playlist wizard — modal dialog.
 *
 * Three inputs:
 *   1. Playlist name (becomes both the .jcp filename and the
 *      <playlist_display_name> on first write — BandMate's convention)
 *   2. Sample rate (44.1 / 48 kHz, segmented control)
 *   3. Track map (dropdown of available .jcm files; required, since
 *      every .jcp must reference one)
 *
 * On Create:
 *   - Calls Rust `create_playlist` to reserve the .jcp filename
 *   - Writes an empty .jcp via the codec
 *   - Triggers a working-folder rescan
 *   - Dispatches `select` so the editor opens on the new playlist
 *
 * Validation mirrors the Rust rules + a collision check against the
 * already-scanned playlists list. Track Map is required and disabled
 * if no track maps exist yet (with a help line pointing at Phase 5).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createEmptyPlaylist, writePlaylist } from "../codec";
import {
  createPlaylist,
  writeTextFile,
} from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Mirrors the Rust validator in `create_playlist`. */
function validateName(
  name: string,
  existingFilenames: Set<string>,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name is required.";
  if (trimmed.length > 64) return "Name is too long (max 64 characters).";
  if (trimmed.startsWith(".")) return "Name cannot start with a dot.";
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Name cannot contain '/' or '\\'.";
  }
  // Collision is checked against `<name>.jcp` since that's the file we
  // reserve. Comparing case-sensitively matches the underlying FS
  // behavior on macOS HFS+ / APFS in case-sensitive mode; users on
  // case-insensitive filesystems will get a clearer error from the
  // Rust create call instead.
  if (existingFilenames.has(`${trimmed}.jcp`)) {
    return `A playlist named "${trimmed}" already exists.`;
  }
  return null;
}

export function NewPlaylistDialog({ isOpen, onClose }: Props) {
  const { state, dispatch, rescan } = useAppState();

  const defaultRate = state.userPrefs.defaultSampleRate;

  const [name, setName] = useState("");
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(defaultRate);
  const [trackMapPath, setTrackMapPath] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the dialog opens. The default track map is
  // the first available one — for most users with one .jcm in the
  // working folder, this is the right pre-selection. Sample rate
  // pulls from userPrefs so changing the Settings default takes
  // effect on the next open.
  useEffect(() => {
    if (isOpen) {
      setName("");
      setSampleRate(defaultRate);
      setTrackMapPath(state.scan.trackMaps[0]?.filename ?? "");
      setCreating(false);
      setCreateError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, state.scan.trackMaps, defaultRate]);

  // ESC closes (unless we're mid-create).
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

  const existingFilenames = useMemo(
    () => new Set(state.scan.playlists.map((p) => p.filename)),
    [state.scan.playlists],
  );

  const validationError = validateName(name, existingFilenames);
  const showValidationError = name.length > 0 && validationError !== null;
  const noTrackMaps = state.scan.trackMaps.length === 0;
  const canCreate =
    !creating &&
    validationError === null &&
    !noTrackMaps &&
    trackMapPath.length > 0 &&
    state.workingFolder !== null;

  const handleCreate = async () => {
    if (!canCreate || !state.workingFolder) return;
    setCreating(true);
    setCreateError(null);
    try {
      // 1. Reserve the .jcp filename.
      const created = await createPlaylist(state.workingFolder, name.trim());
      // 2. Write the empty playlist via the codec.
      const empty = createEmptyPlaylist(name.trim(), sampleRate, trackMapPath);
      await writeTextFile(created.jcpPath, writePlaylist(empty));
      // 3. Refresh the sidebar.
      await rescan();
      // 4. Auto-open in the playlist editor.
      dispatch({
        type: "select",
        selection: { kind: "playlist", path: created.jcpPath },
      });
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
      aria-labelledby="new-playlist-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creating) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="new-playlist-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            New Playlist
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
              placeholder="Spring Tour 2026"
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
              Becomes the .jcp filename and the playlist's display name on
              the BandMate.
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
            <span className="text-[11px] text-zinc-500">
              Every song in the playlist must use this rate. Mismatched songs
              are flagged in the editor.
            </span>
          </fieldset>

          {/* Track map */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Track Map
            </span>
            <select
              value={trackMapPath}
              onChange={(e) => setTrackMapPath(e.target.value)}
              disabled={creating || noTrackMaps}
              className="user-text rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            >
              {noTrackMaps && <option value="">(no track maps available)</option>}
              {state.scan.trackMaps.map((tm) => (
                <option key={tm.path} value={tm.filename}>
                  {tm.filename}
                </option>
              ))}
            </select>
            {noTrackMaps ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                No track maps in the working folder yet — create one in the
                Track Maps section first.
              </span>
            ) : (
              <span className="text-[11px] text-zinc-500">
                Names the 25 output channels. The BandMate uses this on the
                playlist's home screen.
              </span>
            )}
          </label>

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
