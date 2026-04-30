/**
 * Track Map Editor — work surface for the 25-slot label list.
 *
 * State model — single `editor` reducer-style object holding:
 *   - past:     EditorSnapshots of previous states (for undo)
 *   - current:  the working snapshot
 *   - future:   snapshots that were undone, replayed on redo
 *   - baseline: the last-saved snapshot (used for the dirty indicator)
 *
 * Each snapshot is just `{ map: TrackMap }` — track maps are pure
 * label data, no file copies to manage.
 *
 * Body is 25 fixed rows (24 audio + 1 MIDI):
 *   - Number column shows "1"…"24" for audio, "MID" for the MIDI slot
 *   - Editable text input for the label, typed in-place (no edit mode)
 *   - On selected row: ↑ / ↓ reorder + × clear buttons
 *   - Drag rows to reorder via splice (matches PlaylistEditor pattern)
 *   - The MIDI slot (idx 24) is fixed in position — drag/move ignores
 *     anything involving it (there's nowhere else for MIDI to live)
 *
 * Keyboard shortcuts (registered while the editor is mounted):
 *   - Cmd/Ctrl+S         → save (with native confirm dialog)
 *   - Cmd/Ctrl+Z         → undo
 *   - Cmd/Ctrl+Shift+Z   → redo (also Cmd/Ctrl+Y as a Windows alias)
 *   - Delete / Backspace → clear the highlighted row's label
 *
 * Note: text inputs swallow Cmd+Z/Y/etc. natively for their own undo
 * stack. We register the editor's shortcuts on `window` and skip when
 * the event target is one of our inputs to avoid double-handling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseTrackMap,
  writeTrackMap,
  MIDI_CHANNEL_INDEX,
  TRACK_MAP_CHANNEL_COUNT,
  type TrackMap,
} from "../codec";
import {
  createTrackMap,
  readTextFile,
  writeTextFile,
} from "../fs/workingFolder";
import { suggestDuplicateName } from "../lib/references";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";
import {
  readDragPayload,
  setDragImageLabel,
  setDragPayload,
} from "../lib/dnd";
import { diffTrackMaps } from "../lib/snapshotDiff";
import { SaveConfirmDialog } from "./SaveConfirmDialog";
import { TrackMapHeader } from "./TrackMapHeader";
import { UndoHistoryPanel } from "./UndoHistoryPanel";

interface Props {
  jcmPath: string;
}

interface EditorSnapshot {
  map: TrackMap;
}

interface EditorState {
  past: EditorSnapshot[];
  current: EditorSnapshot | null;
  future: EditorSnapshot[];
  baseline: EditorSnapshot | null;
}

const HISTORY_LIMIT = 50;

const EMPTY_EDITOR: EditorState = {
  past: [],
  current: null,
  future: [],
  baseline: null,
};

export function TrackMapEditor({ jcmPath }: Props) {
  const { state, dispatch, rescan, registerDirtyEditor } = useAppState();

  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  /**
   * Selected row index for the on-row arrow / clear buttons. Local
   * state (not in AppState) — track-map editor is mounted as a
   * different "kind" of editor than the song / playlist ones, and
   * those use their own AppState fields. Keeping selection local
   * here avoids adding yet another global field.
   */
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  /**
   * Drag-over indicator. Same pattern as PlaylistSongList: track
   * which row + above/below position is hovered, set on dragOver,
   * cleared on drop / global dragend.
   */
  const [dragOver, setDragOver] = useState<{
    row: number;
    position: "above" | "below";
  } | null>(null);

  useEffect(() => {
    const onEnd = () => setDragOver(null);
    window.addEventListener("dragend", onEnd);
    return () => window.removeEventListener("dragend", onEnd);
  }, []);

  const draftMap = editor.current?.map ?? null;

  const trackMapName = useMemo(
    () =>
      (jcmPath.split("/").pop() ?? "(unknown)")
        .replace(/_tm\.jcm$|\.jcm$/i, ""),
    [jcmPath],
  );
  const fileBasename = useMemo(
    () => jcmPath.split("/").pop() ?? "(unknown)",
    [jcmPath],
  );

  // ---- Snapshot mutators (undo-aware) ------------------------------------

  const applyEdit = useCallback(
    (updater: (snapshot: EditorSnapshot) => EditorSnapshot) => {
      setEditor((e) => {
        if (!e.current) return e;
        const next = updater(e.current);
        // Skip recording if nothing actually changed.
        if (writeTrackMap(next.map) === writeTrackMap(e.current.map)) {
          return e;
        }
        return {
          past: [...e.past, e.current].slice(-HISTORY_LIMIT),
          current: next,
          future: [],
          baseline: e.baseline,
        };
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setEditor((e) => {
      if (e.past.length === 0 || !e.current) return e;
      const prev = e.past[e.past.length - 1]!;
      return {
        past: e.past.slice(0, -1),
        current: prev,
        future: [e.current, ...e.future].slice(0, HISTORY_LIMIT),
        baseline: e.baseline,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setEditor((e) => {
      if (e.future.length === 0 || !e.current) return e;
      const next = e.future[0]!;
      return {
        past: [...e.past, e.current].slice(-HISTORY_LIMIT),
        current: next,
        future: e.future.slice(1),
        baseline: e.baseline,
      };
    });
  }, []);

  /** Jump to a specific snapshot — see SongEditor.jumpToHistoryIndex. */
  const jumpToHistoryIndex = useCallback((targetIdx: number) => {
    setEditor((e) => {
      if (!e.current) return e;
      const flat = [...e.past, e.current, ...e.future];
      if (targetIdx < 0 || targetIdx >= flat.length) return e;
      return {
        past: flat.slice(0, targetIdx),
        current: flat[targetIdx]!,
        future: flat.slice(targetIdx + 1),
        baseline: e.baseline,
      };
    });
  }, []);

  // ---- Load .jcm on mount / when jcmPath changes -------------------------
  useEffect(() => {
    let cancelled = false;
    setEditor(EMPTY_EDITOR);
    setLoadError(null);
    setSaveError(null);
    setSelectedRow(null);
    (async () => {
      try {
        const text = await readTextFile(jcmPath);
        const parsed = parseTrackMap(text);
        if (cancelled) return;
        const initial: EditorSnapshot = { map: parsed };
        setEditor({
          past: [],
          current: initial,
          future: [],
          baseline: initial,
        });
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jcmPath]);

  // ---- Edit handlers ------------------------------------------------------

  /** Change the label at row `idx` to `value` (typed inline). */
  const handleLabelChange = useCallback(
    (idx: number, value: string) => {
      applyEdit((snap) => {
        if (snap.map.channels[idx] === value) return snap;
        const channels = snap.map.channels.slice();
        channels[idx] = value;
        return { map: { channels } };
      });
    },
    [applyEdit],
  );

  /** Clear the label at row `idx` (sets it to empty string). */
  const handleClearRow = useCallback(
    (idx: number) => {
      applyEdit((snap) => {
        if (snap.map.channels[idx] === "") return snap;
        const channels = snap.map.channels.slice();
        channels[idx] = "";
        return { map: { channels } };
      });
    },
    [applyEdit],
  );

  /**
   * Move the row at `from` to source-index `to` (splice semantics
   * matching PlaylistEditor's reorder). Both indices are bounded to
   * the audio range — the MIDI slot stays put.
   *
   * `to` is a source-array index where the moved label should land
   * post-move; `to == from` and `to == from + 1` are no-ops.
   */
  const handleReorderTo = useCallback(
    (from: number, to: number) => {
      if (from === MIDI_CHANNEL_INDEX) return;
      // Don't let moves push past or onto the MIDI slot — clamp.
      const audioMax = MIDI_CHANNEL_INDEX; // splice index space upper bound
      if (to < 0 || to > audioMax) return;
      if (to === from || to === from + 1) return;
      applyEdit((snap) => {
        const channels = snap.map.channels.slice();
        const [item] = channels.splice(from, 1);
        const insertAt = to > from ? to - 1 : to;
        channels.splice(insertAt, 0, item!);
        // The splice above could have shifted things into the MIDI
        // slot if from < 24. Splice is length-preserving overall, so
        // length stays at 25 — the MIDI slot's current value just
        // depends on whether it was in [from..to] range. Since we
        // cap moves to <= MIDI_CHANNEL_INDEX in the index space,
        // anything beyond that is a no-op above. The MIDI label stays
        // at index 24 unmodified as long as `to <= 24` and
        // `from < 24` — verified by construction.
        return { map: { channels } };
      });
      // Track the moved row for chained reorders.
      const finalIndex = to > from ? to - 1 : to;
      setSelectedRow(finalIndex);
    },
    [applyEdit],
  );

  /** Convenience wrapper for ↑ / ↓ buttons on selected rows. */
  const handleMoveRow = useCallback(
    (row: number, delta: -1 | 1) => {
      handleReorderTo(row, delta === -1 ? row - 1 : row + 2);
    },
    [handleReorderTo],
  );

  // ---- Dirty check -------------------------------------------------------
  const isDirty = useMemo(() => {
    if (!editor.current || !editor.baseline) return false;
    return (
      writeTrackMap(editor.current.map) !==
      writeTrackMap(editor.baseline.map)
    );
  }, [editor]);

  // Register dirty state for the unsaved-changes guard.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    return registerDirtyEditor({
      isDirty: () => isDirtyRef.current,
      label: trackMapName,
    });
  }, [registerDirtyEditor, trackMapName]);

  const canUndo = editor.past.length > 0;
  const canRedo = editor.future.length > 0;

  const filledCount = useMemo(() => {
    if (!draftMap) return 0;
    return draftMap.channels.filter((c) => c.trim().length > 0).length;
  }, [draftMap]);

  // ---- Save --------------------------------------------------------------
  const saveStateRef = useRef({
    snapshot: editor.current,
    isDirty,
    saving,
    jcmPath,
    fileBasename,
  });
  saveStateRef.current = {
    snapshot: editor.current,
    isDirty,
    saving,
    jcmPath,
    fileBasename,
  };

  const handleSave = useCallback(() => {
    const s = saveStateRef.current;
    if (!s.snapshot || s.saving || !s.isDirty) return;
    setSaveDialogOpen(true);
  }, []);

  /** Persist to the existing .jcm path. */
  const performSave = useCallback(async () => {
    const s = saveStateRef.current;
    if (!s.snapshot) return;
    setSaving(true);
    setSaveError(null);
    try {
      const text = writeTrackMap(s.snapshot.map);
      await writeTextFile(s.jcmPath, text);
      setEditor((e) => ({
        past: e.past,
        current: e.current,
        future: e.future,
        baseline: e.current,
      }));
      await rescan();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [rescan]);

  /** Save current snapshot to a new .jcm under `newName`. */
  const performSaveAs = useCallback(
    async (newName: string) => {
      const s = saveStateRef.current;
      if (!s.snapshot || !state.workingFolder) return;
      setSaving(true);
      setSaveError(null);
      try {
        const created = await createTrackMap(state.workingFolder, newName);
        await writeTextFile(created.jcmPath, writeTrackMap(s.snapshot.map));
        await rescan();
        dispatch({
          type: "select",
          selection: { kind: "trackMap", path: created.jcmPath },
        });
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [dispatch, rescan, state.workingFolder],
  );

  // ---- Keyboard handlers --------------------------------------------------
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Skip when typing in an input — let the input handle native
      // text editing (incl. its own undo stack).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextInput =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable;

      if (meta && key === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }
      // Don't steal Cmd+Z/Y from focused inputs — they have their
      // own undo. Editor-level undo only fires when focus is outside
      // any input.
      //
      // Use e.code (physical key) rather than e.key — macOS rewrites
      // e.key when Option is held (⌥Z → "Ω"), so the history shortcut
      // wouldn't match.
      if (!isTextInput && meta && e.code === "KeyZ") {
        if (e.altKey) {
          e.preventDefault();
          setHistoryOpen((cur) => !cur);
          return;
        }
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (!isTextInput && meta && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      // Cmd/Ctrl + Arrow — move the highlighted row up/down. Skipped
      // when typing in an input (the user might be navigating their
      // text caret). MIDI slot stays put.
      if (
        !isTextInput &&
        meta &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        if (selectedRow === null) return;
        if (selectedRow === MIDI_CHANNEL_INDEX) return;
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? -1 : 1;
        handleMoveRow(selectedRow, delta);
        return;
      }
      if (!isTextInput && (e.key === "Delete" || e.key === "Backspace")) {
        if (selectedRow !== null) {
          e.preventDefault();
          handleClearRow(selectedRow);
        }
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [handleSave, handleClearRow, handleMoveRow, undo, redo, selectedRow]);

  // ---- Render -------------------------------------------------------------

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col bg-white p-12 dark:bg-zinc-950">
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          Failed to load track map: {loadError}
        </p>
      </main>
    );
  }

  if (!draftMap) {
    return (
      <main className="flex flex-1 items-center justify-center bg-white dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <TrackMapHeader
        trackMapName={trackMapName}
        filledCount={filledCount}
        isDirty={isDirty}
        saving={saving}
        saveError={saveError}
        onSave={handleSave}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <div className="flex-1 overflow-y-auto">
        <TrackMapList
          channels={draftMap.channels}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          onLabelChange={handleLabelChange}
          onMoveRow={handleMoveRow}
          onReorderTo={handleReorderTo}
          onClearRow={handleClearRow}
          dragOver={dragOver}
          setDragOver={setDragOver}
        />
      </div>

      <UndoHistoryPanel
        isOpen={historyOpen}
        pastCount={editor.past.length}
        futureCount={editor.future.length}
        baselineIndex={(() => {
          if (!editor.baseline || !editor.current) return null;
          const flat = [...editor.past, editor.current, ...editor.future];
          const baselineKey = writeTrackMap(editor.baseline.map);
          for (let i = 0; i < flat.length; i++) {
            if (writeTrackMap(flat[i]!.map) === baselineKey) return i;
          }
          return null;
        })()}
        entryLabels={(() => {
          if (!editor.current) return undefined;
          const flat = [...editor.past, editor.current, ...editor.future];
          return flat.map((snap, i) =>
            i === 0
              ? "Initial state"
              : diffTrackMaps(flat[i - 1]!.map, snap.map),
          );
        })()}
        onJumpTo={(idx) => jumpToHistoryIndex(idx)}
        onClose={() => setHistoryOpen(false)}
      />

      <SaveConfirmDialog
        isOpen={saveDialogOpen}
        title="Save Track Map"
        subjectName={fileBasename}
        message={
          <>
            Overwrites the existing{" "}
            <span className="font-mono">.jcm</span> file. Playlists that
            reference it by filename are unaffected.
          </>
        }
        existingNames={
          new Set(
            state.scan.trackMaps.map((t) =>
              t.filename.replace(/\.jcm$/i, ""),
            ),
          )
        }
        defaultNewName={suggestDuplicateName(
          trackMapName,
          new Set(
            state.scan.trackMaps.map((t) =>
              t.filename.replace(/\.jcm$/i, ""),
            ),
          ),
        )}
        itemKind="track map"
        onSave={performSave}
        onSaveAs={performSaveAs}
        onClose={() => setSaveDialogOpen(false)}
      />
    </main>
  );
}

// ---------------------------------------------------------------------------
// 25-row label list
// ---------------------------------------------------------------------------

const COLS = "grid-cols-[44px_1fr_84px]";

function TrackMapList({
  channels,
  selectedRow,
  onSelectRow,
  onLabelChange,
  onMoveRow,
  onReorderTo,
  onClearRow,
  dragOver,
  setDragOver,
}: {
  channels: string[];
  selectedRow: number | null;
  onSelectRow: (row: number | null) => void;
  onLabelChange: (idx: number, value: string) => void;
  onMoveRow: (row: number, delta: -1 | 1) => void;
  onReorderTo: (from: number, to: number) => void;
  onClearRow: (idx: number) => void;
  dragOver: { row: number; position: "above" | "below" } | null;
  setDragOver: (
    v: { row: number; position: "above" | "below" } | null,
  ) => void;
}) {
  const dropPositionFor = (row: number, position: "above" | "below"): number =>
    position === "above" ? row : row + 1;

  return (
    <>
      <header
        className={`grid ${COLS} sticky top-0 z-10 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 eyebrow dark:border-zinc-800 dark:bg-zinc-900/80`}
      >
        <span className="text-right">Ch</span>
        <span>Label</span>
        <span /> {/* arrows / clear column */}
      </header>
      <div>
        {Array.from({ length: TRACK_MAP_CHANNEL_COUNT }).map((_, idx) => {
          const isMidi = idx === MIDI_CHANNEL_INDEX;
          const isSelected = selectedRow === idx;
          const value = channels[idx] ?? "";
          const showLineAbove =
            !isMidi &&
            dragOver?.row === idx &&
            dragOver.position === "above";
          const showLineBelow =
            !isMidi &&
            dragOver?.row === idx &&
            dragOver.position === "below";
          return (
            <div
              key={idx}
              role="row"
              draggable={!isMidi}
              onDragStart={(e) => {
                if (isMidi) return;
                setDragPayload(e, { kind: "trackmap-row", from: idx });
                setDragImageLabel(e, value || `Channel ${idx + 1}`);
              }}
              onDragOver={(e) => {
                if (isMidi) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const isLowerHalf =
                  e.clientY > rect.top + rect.height / 2;
                const position: "above" | "below" = isLowerHalf
                  ? "below"
                  : "above";
                if (
                  !dragOver ||
                  dragOver.row !== idx ||
                  dragOver.position !== position
                ) {
                  setDragOver({ row: idx, position });
                }
              }}
              onDrop={(e) => {
                if (isMidi) return;
                e.preventDefault();
                const payload = readDragPayload(e);
                const position = dragOver
                  ? dropPositionFor(dragOver.row, dragOver.position)
                  : idx;
                setDragOver(null);
                if (payload?.kind !== "trackmap-row") return;
                if (payload.from === idx) return;
                onReorderTo(payload.from, position);
              }}
              onClick={(e) => {
                // Click anywhere on the row (other than the input or
                // the action buttons) toggles selection.
                const t = e.target as HTMLElement;
                if (t.tagName === "INPUT" || t.closest("button")) return;
                onSelectRow(isSelected ? null : idx);
              }}
              className={cn(
                `relative grid ${COLS} w-full items-center gap-2 border-b px-3 py-1.5 text-left transition-colors`,
                !isMidi && "cursor-grab active:cursor-grabbing",
                showLineAbove &&
                  "before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 before:bg-brand-500 before:content-['']",
                showLineBelow &&
                  "after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-1 after:bg-brand-500 after:content-['']",
                (showLineAbove || showLineBelow) &&
                  "bg-zinc-100 dark:bg-zinc-800/60",
                !showLineAbove &&
                  !showLineBelow &&
                  (isSelected
                    ? "border-zinc-100 bg-brand-50 dark:border-zinc-900 dark:bg-brand-950/30"
                    : isMidi
                      ? "border-zinc-200 bg-green-50/40 hover:bg-green-100/60 dark:border-zinc-800 dark:bg-green-950/10 dark:hover:bg-green-900/30"
                      : "border-zinc-100 hover:bg-zinc-100 dark:border-zinc-900 dark:hover:bg-zinc-800/60"),
              )}
            >
              {isSelected && !showLineAbove && !showLineBelow && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-brand-500"
                />
              )}

              <span
                className={cn(
                  "text-right font-mono text-xs tabular-nums",
                  isMidi
                    ? "text-green-700 dark:text-green-500"
                    : isSelected
                      ? "text-brand-700 dark:text-brand-300"
                      : "text-zinc-500",
                )}
              >
                {isMidi ? "MID" : idx + 1}
              </span>

              <input
                type="text"
                value={value}
                onChange={(e) => onLabelChange(idx, e.target.value)}
                onFocus={() => onSelectRow(idx)}
                placeholder={
                  isMidi ? "(MIDI label, e.g. Kemper)" : `Channel ${idx + 1}`
                }
                maxLength={64}
                spellCheck={false}
                className="user-text rounded-sm bg-transparent px-1.5 py-0.5 font-mono text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-accent-300 dark:text-zinc-200 dark:placeholder:text-zinc-600 dark:focus:bg-zinc-950 dark:focus:ring-accent-700"
              />

              <span className="flex items-center justify-end gap-0.5">
                {isSelected && !isMidi && (
                  <>
                    <RowArrowButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveRow(idx, -1);
                      }}
                      disabled={idx === 0}
                      title="Move up (⌘↑)"
                      ariaLabel="Move up"
                    >
                      <ArrowUpIcon className="h-3 w-3" />
                    </RowArrowButton>
                    <RowArrowButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveRow(idx, 1);
                      }}
                      disabled={idx === MIDI_CHANNEL_INDEX - 1}
                      title="Move down (⌘↓)"
                      ariaLabel="Move down"
                    >
                      <ArrowDownIcon className="h-3 w-3" />
                    </RowArrowButton>
                    <RowArrowButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearRow(idx);
                      }}
                      title="Clear label (Delete)"
                      ariaLabel="Clear label"
                      danger
                    >
                      <CloseIcon className="h-3 w-3" />
                    </RowArrowButton>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function RowArrowButton({
  children,
  onClick,
  disabled,
  title,
  ariaLabel,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title: string;
  ariaLabel: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded transition",
        disabled
          ? "cursor-not-allowed text-zinc-300 dark:text-zinc-700"
          : danger
            ? "text-red-500 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
            : "text-brand-600 hover:bg-brand-100 hover:text-brand-700 dark:text-brand-300 dark:hover:bg-brand-900 dark:hover:text-brand-100",
      )}
    >
      {children}
    </button>
  );
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
