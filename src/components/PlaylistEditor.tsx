/**
 * Playlist Editor — main work surface for assembling a `.jcp`.
 *
 * State model — single `editor` reducer-style object holding:
 *   - `past`:     EditorSnapshots of previous states (for undo)
 *   - `current`:  the working snapshot
 *   - `future`:   snapshots that were undone, replayed on redo
 *   - `baseline`: the last-saved snapshot (used for the dirty indicator)
 *
 * Each snapshot is just `{ playlist: Playlist }` — no pendingCopies
 * machinery like SongEditor needs, because playlists don't queue file
 * copies (they reference song folders by name only).
 *
 * Keyboard shortcuts (registered while the editor is mounted):
 *   - Cmd/Ctrl+S         → save (with native confirm dialog)
 *   - Cmd/Ctrl+Z         → undo
 *   - Cmd/Ctrl+Shift+Z   → redo (also Cmd/Ctrl+Y as a Windows-style alias)
 *   - Delete / Backspace → remove the highlighted song from the playlist
 *
 * Layout:
 *   [PlaylistHeader]
 *   ┌─────────────────────────────────┬─────────────────┐
 *   │ Ordered song list (this file)   │ AvailableSongs  │
 *   │   - selected row shows ↑ ↓      │   (right rail)  │
 *   └─────────────────────────────────┴─────────────────┘
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  parsePlaylist,
  parseSong,
  writePlaylist,
  type Playlist,
} from "../codec";
import { readTextFile, writeTextFile } from "../fs/workingFolder";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";
import {
  readDragPayload,
  setDragImageLabel,
  setDragPayload,
} from "../lib/dnd";
import { AvailableSongsPane } from "./AvailableSongsPane";
import { PlaylistHeader } from "./PlaylistHeader";

interface Props {
  jcpPath: string;
}

interface EditorSnapshot {
  playlist: Playlist;
}

/** Metadata extracted from a song's `.jcs`, cached for validation. */
interface SongMeta {
  sampleRate: number;
  lengthSamples: number;
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

export function PlaylistEditor({ jcpPath }: Props) {
  const { state, dispatch, rescan } = useAppState();

  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * Per-song metadata, keyed by folder name. Built by reading every
   * `.jcs` in the working folder when the editor mounts (or after a
   * rescan). Used for missing/rate-mismatch flags and for the
   * playlist's total duration in the header.
   *
   * Songs that fail to read or parse are simply absent from the map —
   * they'll surface as "Missing" in the row badge.
   */
  const [songMeta, setSongMeta] = useState<Map<string, SongMeta>>(new Map());

  const draftPlaylist = editor.current?.playlist ?? null;

  const playlistFilename = useMemo(
    () => jcpPath.split("/").pop() ?? "(unknown)",
    [jcpPath],
  );
  const playlistDisplayName = useMemo(
    () => playlistFilename.replace(/\.jcp$/i, ""),
    [playlistFilename],
  );

  // ---- Snapshot mutators (undo-aware) -------------------------------------
  const applyEdit = useCallback(
    (updater: (snapshot: EditorSnapshot) => EditorSnapshot) => {
      setEditor((e) => {
        if (!e.current) return e;
        const next = updater(e.current);
        // Skip recording if nothing actually changed.
        if (writePlaylist(next.playlist) === writePlaylist(e.current.playlist)) {
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

  // ---- Load all song metadata in parallel --------------------------------
  // Cheap-ish — .jcs files are small, and the user rarely has more than
  // 30. Re-runs whenever the scan changes (e.g. after a save that adds
  // a new song). Failures are swallowed: a song that won't parse will
  // show as "Missing" in the row, which is more useful than a blocking
  // error.
  useEffect(() => {
    let cancelled = false;
    const songs = state.scan.songs;
    Promise.all(
      songs.map(async (s) => {
        try {
          const text = await readTextFile(s.jcsPath);
          const parsed = parseSong(text);
          return [
            s.folderName,
            { sampleRate: parsed.sampleRate, lengthSamples: parsed.lengthSamples },
          ] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const m = new Map<string, SongMeta>();
      for (const e of entries) if (e) m.set(e[0], e[1]);
      setSongMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [state.scan.songs]);

  // ---- Load .jcp on mount / when jcpPath changes --------------------------
  useEffect(() => {
    let cancelled = false;
    setEditor(EMPTY_EDITOR);
    setLoadError(null);
    setSaveError(null);
    (async () => {
      try {
        const text = await readTextFile(jcpPath);
        const parsed = parsePlaylist(text);
        if (cancelled) return;
        const initialSnapshot: EditorSnapshot = { playlist: parsed };
        setEditor({
          past: [],
          current: initialSnapshot,
          future: [],
          baseline: initialSnapshot,
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
  }, [jcpPath]);

  // ---- Edit handlers ------------------------------------------------------

  const handleSampleRateChange = useCallback(
    (sampleRate: number) => {
      applyEdit((snap) => ({
        playlist: { ...snap.playlist, sampleRate },
      }));
    },
    [applyEdit],
  );

  const handlePickTrackMap = useCallback(
    (filename: string) => {
      applyEdit((snap) => ({
        playlist: { ...snap.playlist, trackMap: filename },
      }));
    },
    [applyEdit],
  );

  const handleSelectRow = useCallback(
    (row: number | null) => {
      dispatch({ type: "select_playlist_row", row });
    },
    [dispatch],
  );

  /**
   * Insert a song folder name into the playlist.
   *
   *   - If `position` is omitted, append (click-to-add behavior).
   *   - If `position` is provided, splice at that index (drag-drop
   *     from the available pane). `position` is interpreted in the
   *     SOURCE array's index space, so `position == songNames.length`
   *     means "after the last row".
   */
  const handleAddSong = useCallback(
    (folderName: string, position?: number) => {
      applyEdit((snap) => {
        const next = snap.playlist.songNames.slice();
        const insertAt =
          position === undefined
            ? next.length
            : Math.max(0, Math.min(next.length, position));
        next.splice(insertAt, 0, folderName);
        return {
          playlist: { ...snap.playlist, songNames: next },
        };
      });
    },
    [applyEdit],
  );

  const handleRemoveRow = useCallback(
    (row: number) => {
      applyEdit((snap) => {
        const next = snap.playlist.songNames.slice();
        if (row < 0 || row >= next.length) return snap;
        next.splice(row, 1);
        return {
          playlist: { ...snap.playlist, songNames: next },
        };
      });
      // Adjust selection: if we removed the selected row, drop the
      // highlight; if we removed a row above it, shift it up by 1.
      const sel = state.playlistRowSelection;
      if (sel === null) return;
      if (sel === row) {
        dispatch({ type: "select_playlist_row", row: null });
      } else if (sel > row) {
        dispatch({ type: "select_playlist_row", row: sel - 1 });
      }
    },
    [applyEdit, dispatch, state.playlistRowSelection],
  );

  /**
   * Move a row from its current index to a target index in the
   * SOURCE array's index space. Used by both the on-row arrow buttons
   * (deltas of ±1) and drag-drop reorders (arbitrary distances).
   *
   * `to` is the desired final position, expressed against the
   * source-array indices (so `to == songs.length` means "after the
   * last row"). Adjacent / no-op moves are filtered.
   */
  const handleReorderTo = useCallback(
    (from: number, to: number) => {
      applyEdit((snap) => {
        const songs = snap.playlist.songNames;
        if (from < 0 || from >= songs.length) return snap;
        if (to < 0 || to > songs.length) return snap;
        if (to === from || to === from + 1) return snap; // no-op
        const next = songs.slice();
        const [item] = next.splice(from, 1);
        // Adjust for the splice having shifted indices ≥ `from` down by 1.
        const insertAt = to > from ? to - 1 : to;
        next.splice(insertAt, 0, item!);
        return {
          playlist: { ...snap.playlist, songNames: next },
        };
      });
      // Keep the selection following the moved row so the user can
      // chain multiple moves without re-clicking.
      const sel = state.playlistRowSelection;
      if (sel === from) {
        const finalIndex = to > from ? to - 1 : to;
        dispatch({ type: "select_playlist_row", row: finalIndex });
      }
    },
    [applyEdit, dispatch, state.playlistRowSelection],
  );

  /**
   * Convenience wrapper for the on-row arrow buttons. Translates a
   * ±1 delta into an absolute target and delegates to handleReorderTo.
   */
  const handleMoveRow = useCallback(
    (row: number, delta: -1 | 1) => {
      // delta = -1 (up): target = row - 1 in source array, which means
      //   inserting at index `row - 1` in the source-index space.
      // delta = +1 (down): target index in source space is `row + 2`
      //   (above the row that currently sits at row + 1).
      handleReorderTo(row, delta === -1 ? row - 1 : row + 2);
    },
    [handleReorderTo],
  );

  // ---- Dirty check -------------------------------------------------------
  const isDirty = useMemo(() => {
    if (!editor.current || !editor.baseline) return false;
    return (
      writePlaylist(editor.current.playlist) !==
      writePlaylist(editor.baseline.playlist)
    );
  }, [editor]);

  const canUndo = editor.past.length > 0;
  const canRedo = editor.future.length > 0;

  // ---- Save --------------------------------------------------------------
  const saveStateRef = useRef({
    snapshot: editor.current,
    isDirty,
    saving,
    jcpPath,
    displayName: playlistDisplayName,
  });
  saveStateRef.current = {
    snapshot: editor.current,
    isDirty,
    saving,
    jcpPath,
    displayName: playlistDisplayName,
  };

  const handleSave = useCallback(async () => {
    const s = saveStateRef.current;
    if (!s.snapshot || s.saving || !s.isDirty) return;

    const confirmed = await ask(
      `Save changes to "${s.displayName}"?\n\nThis will overwrite the existing .jcp file.`,
      {
        title: "Save Playlist",
        kind: "info",
        okLabel: "Save",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;

    setSaving(true);
    setSaveError(null);
    try {
      const text = writePlaylist(s.snapshot.playlist);
      await writeTextFile(s.jcpPath, text);
      // New baseline = current state. Don't clear past/future; undo
      // across save is allowed (matches SongEditor behavior).
      setEditor((e) => ({
        past: e.past,
        current: e.current,
        future: e.future,
        baseline: e.current,
      }));
      await rescan();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [rescan]);

  // ---- Keyboard handlers --------------------------------------------------
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (meta && key === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }
      if (meta && key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (meta && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target?.isContentEditable
        ) {
          return;
        }
        if (state.playlistRowSelection !== null) {
          e.preventDefault();
          handleRemoveRow(state.playlistRowSelection);
        }
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [
    handleSave,
    handleRemoveRow,
    undo,
    redo,
    state.playlistRowSelection,
  ]);

  // ---- Render -------------------------------------------------------------

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col bg-white p-12 dark:bg-zinc-950">
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          Failed to load playlist: {loadError}
        </p>
      </main>
    );
  }

  if (!draftPlaylist) {
    return (
      <main className="flex flex-1 items-center justify-center bg-white dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading…</p>
      </main>
    );
  }

  const inPlaylist = new Set(draftPlaylist.songNames);

  // Validation: per-row severity, plus aggregate counts for the
  // header banner. Computed inline (cheap — songNames is small)
  // rather than memoized; React only re-renders on draftPlaylist /
  // songMeta change anyway.
  const songStatuses = draftPlaylist.songNames.map<SongRowStatus>((name) => {
    const meta = songMeta.get(name);
    if (!meta) return { kind: "missing" };
    if (meta.sampleRate !== draftPlaylist.sampleRate) {
      return { kind: "rate-mismatch", actualRate: meta.sampleRate };
    }
    return { kind: "ok", durationSeconds: meta.lengthSamples / meta.sampleRate };
  });
  const missingCount = songStatuses.filter((s) => s.kind === "missing").length;
  const mismatchCount = songStatuses.filter(
    (s) => s.kind === "rate-mismatch",
  ).length;
  const totalDurationSeconds =
    draftPlaylist.songNames.length === 0
      ? 0
      : songStatuses.reduce(
          (acc, s) => acc + (s.kind === "ok" ? s.durationSeconds : 0),
          0,
        );
  // Use null in the header when we genuinely don't know yet (songs in
  // the playlist whose meta hasn't loaded). For an empty playlist,
  // 0 is correct.
  const headerDuration =
    draftPlaylist.songNames.length === 0
      ? 0
      : missingCount > 0 || songMeta.size === 0
        ? null
        : totalDurationSeconds;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <PlaylistHeader
        playlistName={playlistDisplayName}
        sampleRate={draftPlaylist.sampleRate}
        songCount={draftPlaylist.songNames.length}
        totalDurationSeconds={headerDuration}
        trackMaps={state.scan.trackMaps}
        trackMapFilename={draftPlaylist.trackMap}
        onPickTrackMap={handlePickTrackMap}
        onSampleRateChange={handleSampleRateChange}
        isDirty={isDirty}
        saving={saving}
        saveError={saveError}
        onSave={handleSave}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {(missingCount > 0 || mismatchCount > 0) && (
        <ValidationBanner
          missingCount={missingCount}
          mismatchCount={mismatchCount}
          playlistRate={draftPlaylist.sampleRate}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <PlaylistSongList
          songs={draftPlaylist.songNames}
          songStatuses={songStatuses}
          playlistSampleRate={draftPlaylist.sampleRate}
          selectedRow={state.playlistRowSelection}
          onSelectRow={handleSelectRow}
          onMoveRow={handleMoveRow}
          onReorderTo={handleReorderTo}
          onRemoveRow={handleRemoveRow}
          onInsertSongAt={(folderName, position) =>
            handleAddSong(folderName, position)
          }
        />
        <AvailableSongsPane
          allSongs={state.scan.songs}
          inPlaylist={inPlaylist}
          onAdd={handleAddSong}
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Per-row validation result.
 *
 *   - `ok`:           song exists and matches the playlist's rate
 *   - `missing`:      no folder under bm_sources/ matches this name
 *   - `rate-mismatch`: song exists but its sample rate ≠ playlist's
 */
type SongRowStatus =
  | { kind: "ok"; durationSeconds: number }
  | { kind: "missing" }
  | { kind: "rate-mismatch"; actualRate: number };

function ValidationBanner({
  missingCount,
  mismatchCount,
  playlistRate,
}: {
  missingCount: number;
  mismatchCount: number;
  playlistRate: number;
}) {
  const parts: string[] = [];
  if (missingCount > 0) {
    parts.push(
      `${missingCount} ${missingCount === 1 ? "song is" : "songs are"} missing from the working folder`,
    );
  }
  if (mismatchCount > 0) {
    parts.push(
      `${mismatchCount} ${mismatchCount === 1 ? "song doesn't" : "songs don't"} match the playlist's ${(playlistRate / 1000).toFixed(1)} kHz rate`,
    );
  }
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-6 py-1.5 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
    >
      <WarningIcon className="h-3.5 w-3.5 shrink-0" />
      <span>
        {parts.join("; ")}. The BandMate will skip mismatched songs and won't
        find missing ones until you fix the playlist.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ordered song list — center pane
// ---------------------------------------------------------------------------

const COLS = "grid-cols-[40px_1fr_auto_72px]";

function PlaylistSongList({
  songs,
  songStatuses,
  playlistSampleRate,
  selectedRow,
  onSelectRow,
  onMoveRow,
  onReorderTo,
  onRemoveRow,
  onInsertSongAt,
}: {
  songs: string[];
  songStatuses: SongRowStatus[];
  playlistSampleRate: number;
  selectedRow: number | null;
  onSelectRow: (row: number | null) => void;
  onMoveRow: (row: number, delta: -1 | 1) => void;
  /** Drag-drop reorder: move the row at `from` to source-index `to`. */
  onReorderTo: (from: number, to: number) => void;
  onRemoveRow: (row: number) => void;
  /** Drag-drop add: insert a song folder name at source-index `position`. */
  onInsertSongAt: (folderName: string, position: number) => void;
}) {
  const handleToggle = (row: number) => {
    onSelectRow(selectedRow === row ? null : row);
  };

  // Track the row currently being hovered over during a drag, plus
  // whether the cursor is in the upper or lower half (which decides
  // whether the insertion line shows above or below the row).
  //
  // Pattern: source of truth is `onDragOver` (fires continuously
  // while cursor is over a row). We don't use dragEnter / dragLeave
  // — those misbehave when the cursor crosses into a child element.
  // Cleared on drop + on a global dragend listener.
  const [dragOver, setDragOver] = useState<{
    row: number;
    position: "above" | "below";
  } | null>(null);

  useEffect(() => {
    const onEnd = () => setDragOver(null);
    window.addEventListener("dragend", onEnd);
    return () => window.removeEventListener("dragend", onEnd);
  }, []);

  /** Translate a (row index, dragOver position) to an absolute index. */
  const dropPositionFor = (row: number, position: "above" | "below"): number =>
    position === "above" ? row : row + 1;

  /** Apply the current drag payload at the given source-index. */
  const applyDropAt = (e: React.DragEvent, position: number) => {
    const payload = readDragPayload(e);
    if (!payload) return;
    if (payload.kind === "playlist-row") {
      onReorderTo(payload.from, position);
    } else if (payload.kind === "available-song") {
      onInsertSongAt(payload.folderName, position);
    }
    // source-file payloads (channel-grid drags) are ignored here.
  };

  /** Drop handler used by the empty-playlist placeholder + the
   *  trailing "below all rows" sentinel. Always inserts at the end. */
  const handleEmptyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    applyDropAt(e, songs.length);
  };

  /** dragOver handler for the trailing flex-1 zone. Always allow drop;
   *  drop handler validates payload kind. */
  const handleEmptyDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800">
      <header
        className={`grid ${COLS} shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50`}
      >
        <span className="text-right">#</span>
        <span>Song</span>
        <span /> {/* status badge column */}
        <span /> {/* arrows column */}
      </header>
      {songs.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-start px-6 pt-12 text-center"
          onDragOver={handleEmptyDragOver}
          onDrop={handleEmptyDrop}
        >
          <h3 className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Empty playlist
          </h3>
          <p className="max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Click songs in the <strong>Available Songs</strong> pane on the
            right to append them, or drag songs over to drop them in. Click a
            song row to select it; the selected row gets ↑ ↓ buttons for
            reordering and Delete to remove.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-y-auto">
          {songs.map((name, idx) => {
            const isSelected = selectedRow === idx;
            const status = songStatuses[idx] ?? { kind: "ok", durationSeconds: 0 };
            // Both kinds of bad state are errors — a mismatched-rate
            // song won't play correctly on the BandMate, same severity
            // as a missing one. Red row tint either way.
            const hasError =
              status.kind === "missing" || status.kind === "rate-mismatch";
            const showLineAbove =
              dragOver?.row === idx && dragOver.position === "above";
            const showLineBelow =
              dragOver?.row === idx && dragOver.position === "below";
            return (
              <button
                key={`${idx}:${name}`}
                type="button"
                onClick={() => handleToggle(idx)}
                aria-pressed={isSelected}
                draggable
                onDragStart={(e) => {
                  setDragPayload(e, { kind: "playlist-row", from: idx });
                  setDragImageLabel(e, name);
                }}
                onDragOver={(e) => {
                  // Always allow drop; validate payload kind in onDrop.
                  e.preventDefault();
                  e.dataTransfer.dropEffect =
                    readDragPayload(e)?.kind === "playlist-row"
                      ? "move"
                      : "copy";
                  // Refine above/below based on cursor position within
                  // the row's bounding box. Below = lower half.
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isLowerHalf =
                    e.clientY > rect.top + rect.height / 2;
                  const position = isLowerHalf ? "below" : "above";
                  setDragOver((cur) =>
                    cur?.row === idx && cur.position === position
                      ? cur
                      : { row: idx, position },
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const position = dragOver
                    ? dropPositionFor(dragOver.row, dragOver.position)
                    : idx;
                  setDragOver(null);
                  applyDropAt(e, position);
                }}
                title={
                  status.kind === "missing"
                    ? `"${name}" not found in bm_sources/. The BandMate will skip this song; rename or remove it from the playlist.`
                    : status.kind === "rate-mismatch"
                      ? `Sample-rate mismatch: this song is ${(status.actualRate / 1000).toFixed(1)} kHz but the playlist is ${(playlistSampleRate / 1000).toFixed(1)} kHz. Re-bounce the song or change the playlist's rate.`
                      : name
                }
                className={cn(
                  `relative grid ${COLS} w-full cursor-grab items-center gap-2 border-b px-3 py-1.5 text-left transition-colors active:cursor-grabbing`,
                  // Drag insertion line at the targeted edge — thick
                  // brand-color bar so it reads as a strong signal,
                  // not a hairline.
                  showLineAbove &&
                    "before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 before:bg-brand-500 before:content-['']",
                  showLineBelow &&
                    "after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-1 after:bg-brand-500 after:content-['']",
                  // Drag-target row tint — uses zinc rather than brand
                  // to stay distinct from the brand-colored selected
                  // state. The line + label carry the brand identity.
                  (showLineAbove || showLineBelow) &&
                    "bg-zinc-100 dark:bg-zinc-800/60",
                  // Resting / hover / selected.
                  !showLineAbove && !showLineBelow &&
                    (isSelected
                      ? "border-zinc-100 bg-brand-50 dark:border-zinc-900 dark:bg-brand-950/30"
                      : hasError
                        ? "border-zinc-100 bg-red-50/40 hover:bg-red-100/60 dark:border-zinc-900 dark:bg-red-950/20 dark:hover:bg-red-950/40"
                        : "border-zinc-100 hover:bg-zinc-100 dark:border-zinc-900 dark:hover:bg-zinc-800/60"),
                )}
              >
                {(showLineAbove || showLineBelow) && (
                  <PlaylistDropZoneLabel
                    position={showLineAbove ? "above" : "below"}
                  />
                )}
                {isSelected && (showLineAbove || showLineBelow) === false && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-brand-500"
                  />
                )}
                <span
                  className={cn(
                    "text-right font-mono text-xs tabular-nums",
                    isSelected
                      ? "text-brand-700 dark:text-brand-300"
                      : "text-zinc-500",
                  )}
                >
                  {idx + 1}
                </span>
                <span
                  className={cn(
                    "user-text truncate text-sm",
                    isSelected
                      ? "text-brand-900 dark:text-brand-100"
                      : hasError
                        ? "text-red-700 dark:text-red-400"
                        : "text-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {name}
                </span>
                <span className="flex justify-end">
                  {status.kind === "missing" && <Tag tone="red">Missing</Tag>}
                  {status.kind === "rate-mismatch" && (
                    // Red (error) to match the Rate flag in SourceFilesPane
                    // and ChannelGrid — a mismatched-rate song won't play
                    // correctly, same severity as everywhere else.
                    <Tag tone="red">Rate</Tag>
                  )}
                </span>
                <span className="flex items-center justify-end gap-0.5">
                  {isSelected && (
                    <>
                      <RowArrowButton
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveRow(idx, -1);
                        }}
                        disabled={idx === 0}
                        title="Move up"
                        ariaLabel="Move up"
                      >
                        <ArrowUpIcon className="h-3 w-3" />
                      </RowArrowButton>
                      <RowArrowButton
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveRow(idx, 1);
                        }}
                        disabled={idx === songs.length - 1}
                        title="Move down"
                        ariaLabel="Move down"
                      >
                        <ArrowDownIcon className="h-3 w-3" />
                      </RowArrowButton>
                      <RowArrowButton
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveRow(idx);
                        }}
                        title="Remove from playlist (Delete)"
                        ariaLabel="Remove from playlist"
                        // Slight tint to flag it as destructive vs the
                        // plain arrows.
                        danger
                      >
                        <CloseIcon className="h-3 w-3" />
                      </RowArrowButton>
                    </>
                  )}
                </span>
              </button>
            );
          })}
          {/* Trailing drop zone — flexes to fill any remaining space
              below the last row, so the user can drop a song anywhere
              in the empty area to append (rather than having to aim at
              a thin strip). On dragOver we mark "below the last row" so
              the insertion line shows under the last row. */}
          <div
            onDragOver={(e) => {
              handleEmptyDragOver(e);
              if (songs.length > 0) {
                setDragOver((cur) =>
                  cur?.row === songs.length - 1 && cur.position === "below"
                    ? cur
                    : { row: songs.length - 1, position: "below" },
                );
              }
            }}
            onDrop={handleEmptyDrop}
            className="min-h-[24px] flex-1"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

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

/**
 * Drop-zone label rendered on a playlist row during dragOver, telling
 * the user where the dragged item will land. Same left-side
 * positioning as the channel-grid label so the drag image (which
 * renders to the lower-right of the cursor) doesn't obscure it.
 *
 *   - position "above": label at top-left, "↑ Insert above"
 *   - position "below": label at bottom-left, "↓ Insert below"
 *
 * `pointer-events-none` so the label doesn't disrupt drag events on
 * the row underneath. Reuses the ArrowUpIcon / ArrowDownIcon defined
 * elsewhere in this file for the on-row reorder buttons.
 */
function PlaylistDropZoneLabel({
  position,
}: {
  position: "above" | "below";
}) {
  const isAbove = position === "above";
  const positionCls = isAbove ? "top-0.5 left-2" : "bottom-0.5 left-2";
  const arrow = isAbove ? (
    <ArrowUpIcon className="h-3 w-3" />
  ) : (
    <ArrowDownIcon className="h-3 w-3" />
  );
  const text = isAbove ? "Insert above" : "Insert below";
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-20 inline-flex items-center gap-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow",
        positionCls,
      )}
    >
      {arrow}
      {text}
    </span>
  );
}

/** Severity badge — same palette / sizing as SourceFilesPane's Tag. */
function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "red" | "amber";
}) {
  const palette = {
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    amber:
      "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  }[tone];
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
        palette,
      )}
    >
      {children}
    </span>
  );
}

/** Heroicons-mini exclamation triangle, used in the validation banner. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      />
    </svg>
  );
}
