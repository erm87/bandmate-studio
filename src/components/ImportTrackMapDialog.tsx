/**
 * Import Track Map dialog.
 *
 * Two entry points feed this one component:
 *
 *   1. Menu-driven — opened from the Sidebar's "+ New Track Map" menu
 *      with no `prepopulated` files. The dialog immediately triggers the
 *      OS folder picker; once a folder is chosen we scan it via
 *      `list_track_maps_in_folder` and render a pickable list. The user
 *      checks the files they want, resolves any name collisions inline,
 *      and clicks Import.
 *
 *   2. Drag-and-drop — Sidebar detects `.jcm` files dropped onto the
 *      Track Maps section and opens this dialog with `prepopulated` set
 *      to the dropped files. The folder-pick step is skipped — we jump
 *      straight to collision resolution (if any), then import.
 *
 * Collision policy (matches the design discussion 2026-05-11):
 *   - Per-file inline resolver with three modes: Overwrite, Rename,
 *     Skip.
 *   - Default mode is "Rename" with an auto-suggested name —
 *     `<basename> (2)_tm.jcm` — so a one-click import never overwrites
 *     an existing file accidentally.
 *   - The Import button is disabled while any selected file has an
 *     unresolved (invalid) rename input.
 *
 * Single-file no-collision drag-drop bypasses this dialog entirely; the
 * Sidebar imports directly. See `Sidebar.handleDropTrackMaps`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  importTrackMap,
  listTrackMapsInFolder,
  type RemoteTrackMap,
} from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";
import { Button } from "./Button";

type CollisionMode = "rename" | "overwrite" | "skip";

interface PerFileState {
  /** The chosen mode for this file. */
  mode: CollisionMode;
  /**
   * Destination filename to use when `mode === "rename"`. Only consulted
   * in rename mode; the import path uses the source filename in
   * overwrite mode and isn't called at all in skip mode.
   */
  renameTo: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /**
   * If set, the dialog skips the folder-pick step and uses these files
   * as the candidate import list. Set when the user drags .jcm files
   * onto the Sidebar.
   */
  prepopulated?: RemoteTrackMap[] | null;
}

/**
 * Suggest a non-colliding filename derived from `original`. Appends
 * " (N)" before the `.jcm` (preserving any `_tm` suffix that BandMate
 * conventions use) and walks N upward until the name is unused.
 *
 * `usedFilenames` should include both the current working folder's
 * scan AND any names already chosen by other files in the same import
 * batch, so simultaneous imports of two colliding files don't pick
 * the same renamed-to name.
 */
function suggestRenamedFilename(
  original: string,
  usedFilenames: Set<string>,
): string {
  const dotIdx = original.toLowerCase().lastIndexOf(".jcm");
  const stem = dotIdx > 0 ? original.slice(0, dotIdx) : original;
  const ext = dotIdx > 0 ? original.slice(dotIdx) : ".jcm";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!usedFilenames.has(candidate.toLowerCase())) return candidate;
  }
  // Fallback shouldn't ever hit — 998 collisions is absurd — but keep
  // a defined return so TS is happy.
  return `${stem} (copy)${ext}`;
}

/** Same filename-shape rules as `create_track_map` validator (Rust side). */
function validateRenameTarget(
  name: string,
  usedFilenames: Set<string>,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Filename is required.";
  if (trimmed.startsWith(".")) return "Filename cannot start with a dot.";
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Filename cannot contain '/' or '\\'.";
  }
  if (!trimmed.toLowerCase().endsWith(".jcm")) {
    return "Filename must end with .jcm.";
  }
  if (usedFilenames.has(trimmed.toLowerCase())) {
    return "A track map with this filename already exists.";
  }
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(seconds: number | null): string {
  if (seconds === null) return "";
  const d = new Date(seconds * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ImportTrackMapDialog({
  isOpen,
  onClose,
  prepopulated,
}: Props) {
  const { state, rescan, dispatch } = useAppState();

  // ----- Source selection / scan state -------------------------------------
  const [sourceFolder, setSourceFolder] = useState<string | null>(null);
  const [available, setAvailable] = useState<RemoteTrackMap[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // ----- Selection + per-file collision resolution ------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Keyed by source filename, since each row in the list is identified
  // by its filename in the source folder.
  const [perFile, setPerFile] = useState<Map<string, PerFileState>>(new Map());

  // ----- Import progress ---------------------------------------------------
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Filenames already in the current working folder, lowercased for
  // case-insensitive comparison (matches APFS default semantics).
  const existingLowercased = useMemo(
    () => new Set(state.scan.trackMaps.map((tm) => tm.filename.toLowerCase())),
    [state.scan.trackMaps],
  );

  // ---- Pick + scan source folder -----------------------------------------

  const pickSourceFolder = useCallback(async () => {
    setScanError(null);
    const result = await openDialog({ directory: true, multiple: false });
    if (typeof result !== "string") {
      // User cancelled the OS picker. If we don't have an existing
      // source yet, close the whole dialog — opening just to immediately
      // cancel should feel like nothing happened.
      if (sourceFolder === null) onClose();
      return;
    }
    setSourceFolder(result);
    setScanning(true);
    try {
      const list = await listTrackMapsInFolder(result);
      setAvailable(list);
      setSelected(new Set());
      setPerFile(new Map());
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
      setAvailable([]);
    } finally {
      setScanning(false);
    }
  }, [sourceFolder, onClose]);

  // ---- Open / reset / drag-drop pre-population ---------------------------

  // Tracks whether the auto folder-pick has been fired for the current
  // open. Strict-Mode double-invocation in dev would otherwise prompt
  // the OS picker twice on a single open.
  const autoPickedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      autoPickedRef.current = false;
      return;
    }
    // Reset on every open.
    setScanError(null);
    setImportError(null);
    setImporting(false);

    if (prepopulated && prepopulated.length > 0) {
      // Drag-drop entry point: skip folder pick, jump straight to the list.
      setSourceFolder(null);
      setAvailable(prepopulated);
      setSelected(new Set(prepopulated.map((m) => m.filename)));
      setPerFile(new Map());
      autoPickedRef.current = true;
      return;
    }

    // Menu entry point: clear state then auto-trigger folder picker once.
    setSourceFolder(null);
    setAvailable([]);
    setSelected(new Set());
    setPerFile(new Map());
    if (!autoPickedRef.current) {
      autoPickedRef.current = true;
      void pickSourceFolder();
    }
  }, [isOpen, prepopulated, pickSourceFolder]);

  // ---- Collision setup on selection change -------------------------------

  // Whenever the selection changes, ensure every newly-selected file
  // with a collision has a PerFileState entry seeded with a sane default
  // (mode: "rename", auto-suggested filename). Deselected files keep
  // their entry around in case the user re-checks them, but we GC if it
  // grows out of sync with selection on first open.
  useEffect(() => {
    setPerFile((prev) => {
      const next = new Map(prev);
      // Used names = existing folder + already-chosen rename targets in this batch.
      const used = new Set(existingLowercased);
      for (const fn of selected) {
        const entry = next.get(fn);
        if (entry && entry.mode === "rename") {
          used.add(entry.renameTo.toLowerCase());
        }
      }
      for (const fn of selected) {
        if (next.has(fn)) continue;
        if (!existingLowercased.has(fn.toLowerCase())) continue;
        const suggested = suggestRenamedFilename(fn, used);
        used.add(suggested.toLowerCase());
        next.set(fn, { mode: "rename", renameTo: suggested });
      }
      return next;
    });
  }, [selected, existingLowercased]);

  // ---- Validation --------------------------------------------------------

  // For each selected file with a collision, check its current PerFileState.
  // Returns the set of source filenames whose state is invalid (blocks Import).
  const invalidSelectedFilenames = useMemo(() => {
    const invalid = new Set<string>();
    // Build the "used names" set incrementally so two renames-to-same-name
    // collide.
    const used = new Set(existingLowercased);
    // Reserve overwrite slots upfront (overwrite consumes the existing slot).
    for (const fn of selected) {
      if (!existingLowercased.has(fn.toLowerCase())) continue;
      const state = perFile.get(fn);
      if (!state || state.mode === "rename") continue;
      // overwrite or skip: not occupying a new slot in `used`.
      if (state.mode === "overwrite") {
        used.delete(fn.toLowerCase()); // overwriting frees the slot
      }
    }
    for (const fn of selected) {
      const collides = existingLowercased.has(fn.toLowerCase());
      if (!collides) {
        // Will land at its original name; reserve the slot.
        used.add(fn.toLowerCase());
        continue;
      }
      const state = perFile.get(fn);
      if (!state) {
        invalid.add(fn);
        continue;
      }
      if (state.mode === "rename") {
        const err = validateRenameTarget(state.renameTo, used);
        if (err) invalid.add(fn);
        else used.add(state.renameTo.toLowerCase());
      }
      // overwrite / skip don't add anything to `used`.
    }
    return invalid;
  }, [selected, perFile, existingLowercased]);

  const collidingSelected = useMemo(() => {
    return Array.from(selected).filter((fn) =>
      existingLowercased.has(fn.toLowerCase()),
    );
  }, [selected, existingLowercased]);

  // ---- Import action -----------------------------------------------------

  const canImport =
    !importing &&
    !scanning &&
    selected.size > 0 &&
    invalidSelectedFilenames.size === 0 &&
    state.workingFolder !== null;

  const handleImport = async () => {
    if (!canImport || !state.workingFolder) return;
    setImporting(true);
    setImportError(null);
    try {
      let lastImportedPath: string | null = null;
      for (const map of available) {
        if (!selected.has(map.filename)) continue;
        const collides = existingLowercased.has(map.filename.toLowerCase());
        if (!collides) {
          lastImportedPath = await importTrackMap(
            map.path,
            state.workingFolder,
            map.filename,
            false,
          );
          continue;
        }
        const fileState = perFile.get(map.filename);
        if (!fileState || fileState.mode === "skip") continue;
        if (fileState.mode === "overwrite") {
          lastImportedPath = await importTrackMap(
            map.path,
            state.workingFolder,
            map.filename,
            true,
          );
        } else {
          // rename
          lastImportedPath = await importTrackMap(
            map.path,
            state.workingFolder,
            fileState.renameTo.trim(),
            false,
          );
        }
      }
      await rescan();
      if (lastImportedPath) {
        dispatch({
          type: "select",
          selection: { kind: "trackMap", path: lastImportedPath },
        });
      }
      onClose();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  // ---- Keyboard: Esc to close --------------------------------------------

  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, importing, onClose]);

  if (!isOpen) return null;

  // ---- Render -----------------------------------------------------------

  const showEmptyState = !scanning && available.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-trackmap-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="import-trackmap-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            Import Track Map
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Copies one or more <span className="font-mono">.jcm</span> files
            into this working folder.
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {/* Source folder line + change link (only for menu entry point) */}
          {!prepopulated && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow">Source folder</span>
              {sourceFolder && (
                <button
                  type="button"
                  onClick={() => void pickSourceFolder()}
                  disabled={scanning || importing}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:opacity-50 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  Change…
                </button>
              )}
            </div>
          )}
          {!prepopulated && sourceFolder && (
            <p
              className="truncate text-xs text-zinc-600 dark:text-zinc-400"
              title={sourceFolder}
            >
              <span className="font-mono">{sourceFolder}</span>
            </p>
          )}

          {scanning && (
            <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
              Scanning for track maps…
            </p>
          )}

          {scanError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {scanError}
            </p>
          )}

          {showEmptyState && sourceFolder && !scanError && (
            <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs italic text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              No <span className="font-mono">.jcm</span> files in this folder.
              Pick a working folder that has a <span className="font-mono">bm_media/bm_trackmaps/</span> directory,
              or a folder of loose <span className="font-mono">.jcm</span> files.
            </p>
          )}

          {available.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="eyebrow">
                  Track maps ({available.length})
                </span>
                {available.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selected.size === available.length) {
                        setSelected(new Set());
                      } else {
                        setSelected(new Set(available.map((m) => m.filename)));
                      }
                    }}
                    disabled={importing}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:opacity-50 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    {selected.size === available.length
                      ? "Deselect all"
                      : "Select all"}
                  </button>
                )}
              </div>

              <ul className="flex flex-col gap-1">
                {available.map((map) => {
                  const isChecked = selected.has(map.filename);
                  const collides = existingLowercased.has(
                    map.filename.toLowerCase(),
                  );
                  return (
                    <li
                      key={map.filename}
                      className={cn(
                        "rounded-md border transition",
                        isChecked
                          ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/30"
                          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
                      )}
                    >
                      <label className="flex cursor-pointer items-start gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(map.filename))
                                next.delete(map.filename);
                              else next.add(map.filename);
                              return next;
                            });
                          }}
                          disabled={importing}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-brand-500 focus:ring-accent-400 dark:border-zinc-700"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            {map.filename}
                          </span>
                          <span className="text-meta text-zinc-500 dark:text-zinc-400">
                            {formatSize(map.sizeBytes)}
                            {map.modifiedSeconds !== null && (
                              <>
                                {" · "}
                                {formatModified(map.modifiedSeconds)}
                              </>
                            )}
                            {collides && (
                              <>
                                {" · "}
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                  name already exists
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                      </label>

                      {/* Inline collision resolver — only when selected AND colliding */}
                      {isChecked && collides && (
                        <CollisionResolver
                          filename={map.filename}
                          state={perFile.get(map.filename)}
                          existingLowercased={existingLowercased}
                          selectedFilenames={selected}
                          perFile={perFile}
                          disabled={importing}
                          onChange={(next) =>
                            setPerFile((prev) => {
                              const m = new Map(prev);
                              m.set(map.filename, next);
                              return m;
                            })
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {importError && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {importError}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {selected.size > 0
              ? `${selected.size} selected${
                  collidingSelected.length > 0
                    ? ` · ${collidingSelected.length} collision${collidingSelected.length === 1 ? "" : "s"}`
                    : ""
                }`
              : "Pick at least one track map to import."}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={!canImport}>
              {importing
                ? "Importing…"
                : selected.size > 1
                  ? `Import ${selected.size} track maps`
                  : "Import"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Inline collision resolver — one row per colliding selected file.
 *
 * Three modes: Rename (default, with editable filename), Overwrite,
 * Skip. The rename input is validated live against the current working
 * folder's filenames plus any other rename-target chosen in this batch
 * so two-imports-to-the-same-name surfaces as an error rather than
 * silently second-wins.
 */
function CollisionResolver({
  filename,
  state,
  existingLowercased,
  selectedFilenames,
  perFile,
  disabled,
  onChange,
}: {
  filename: string;
  state: PerFileState | undefined;
  existingLowercased: Set<string>;
  selectedFilenames: Set<string>;
  perFile: Map<string, PerFileState>;
  disabled: boolean;
  onChange: (next: PerFileState) => void;
}) {
  // Effective state — fall back to a sensible default if the parent
  // hasn't seeded one yet (shouldn't happen in practice; the parent's
  // selection-change effect runs first, but be defensive).
  const effective: PerFileState = state ?? {
    mode: "rename",
    renameTo: filename,
  };

  // Build "used filenames" for rename validation: existing + other
  // batch members' rename targets, EXCLUDING this file's own target.
  const usedForValidation = useMemo(() => {
    const used = new Set(existingLowercased);
    for (const fn of selectedFilenames) {
      if (fn === filename) continue;
      const other = perFile.get(fn);
      if (other && other.mode === "rename") {
        used.add(other.renameTo.toLowerCase());
      }
    }
    return used;
  }, [existingLowercased, selectedFilenames, perFile, filename]);

  const renameError =
    effective.mode === "rename"
      ? validateRenameTarget(effective.renameTo, usedForValidation)
      : null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <span className="eyebrow text-amber-700 dark:text-amber-400">
        Resolve collision
      </span>
      <div className="flex flex-wrap gap-1.5">
        {(["rename", "overwrite", "skip"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...effective, mode })}
            disabled={disabled}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:opacity-50",
              effective.mode === mode
                ? "border-brand-500 bg-brand-100 text-brand-900 dark:border-brand-400 dark:bg-brand-900/40 dark:text-brand-100"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900",
            )}
          >
            {mode === "rename"
              ? "Rename"
              : mode === "overwrite"
                ? "Overwrite"
                : "Skip"}
          </button>
        ))}
      </div>

      {effective.mode === "rename" && (
        <label className="flex flex-col gap-0.5">
          <input
            type="text"
            value={effective.renameTo}
            onChange={(e) =>
              onChange({ ...effective, renameTo: e.target.value })
            }
            disabled={disabled}
            className={cn(
              "user-text rounded-md border bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus-visible:ring-2 dark:bg-zinc-950",
              renameError
                ? "border-red-300 focus-visible:ring-red-400 dark:border-red-700"
                : "border-zinc-300 focus-visible:ring-accent-400 dark:border-zinc-700",
            )}
          />
          {renameError && (
            <span className="text-meta text-red-600 dark:text-red-400">
              {renameError}
            </span>
          )}
        </label>
      )}

      {effective.mode === "overwrite" && (
        <p className="text-meta text-zinc-500 dark:text-zinc-400">
          Replaces the existing{" "}
          <span className="font-mono">{filename}</span> in this folder.
        </p>
      )}

      {effective.mode === "skip" && (
        <p className="text-meta text-zinc-500 dark:text-zinc-400">
          Won't be imported.
        </p>
      )}
    </div>
  );
}
