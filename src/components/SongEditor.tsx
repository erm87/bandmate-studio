/**
 * Song Editor — the main work surface for assembling a song.
 *
 * State model — single `editor` reducer-style object holding:
 *   - `past`:     EditorSnapshots of previous states (for undo)
 *   - `current`:  the working snapshot (mutates with each edit)
 *   - `future`:   snapshots that were undone, replayed on redo
 *   - `baseline`: the last-saved snapshot (used for the dirty indicator)
 *
 * Each `EditorSnapshot` bundles `Song` + `pendingCopies` together so
 * undo also reverses the file-copy queue, not just the song state.
 *
 * Keyboard shortcuts (registered while the editor is mounted):
 *   - Cmd/Ctrl+S         → save (with native confirm dialog)
 *   - Cmd/Ctrl+Z         → undo
 *   - Cmd/Ctrl+Shift+Z   → redo (also Cmd/Ctrl+Y as a Windows-style alias)
 *   - Delete / Backspace → clear the highlighted channel's assignment
 *
 * Save flow:
 *   1. Show native confirm dialog ("Save changes to ...?")
 *   2. Copy any pending source files into the song folder
 *   3. Re-probe the song folder, recompute song <length> from longest WAV
 *   4. Write the .jcs via the codec
 *   5. Set `baseline` to the new state so the dirty indicator clears
 *   6. Trigger working-folder rescan
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  parseSong,
  parseTrackMap,
  writeSong,
  type Song,
  type SongAudioFile,
  type SongMidiFile,
  type TrackMap,
} from "../codec";
import { TRACK_MAP_CHANNEL_COUNT, MIDI_CHANNEL_INDEX } from "../codec";
import {
  copyIntoFolder,
  listAudioFiles,
  readTextFile,
  writeTextFile,
} from "../fs/workingFolder";
import type { AudioFileInfo } from "../fs/types";
import { useAppState } from "../state/AppState";
import { ChannelGrid } from "./ChannelGrid";
import { SongHeader } from "./SongHeader";
import { SourceFilesPane } from "./SourceFilesPane";

interface Props {
  jcsPath: string;
}

interface PendingCopy {
  sourcePath: string;
  filename: string;
  /**
   * The WAV's actual sample rate at click time. Captured here because
   * the file isn't yet in the song folder, so the song-folder probe
   * doesn't know about it. Used to flag rate-mismatch in the channel
   * grid even before the save-time copy happens.
   */
  sampleRate: number;
}

interface EditorSnapshot {
  song: Song;
  /** Map<channelIndex, PendingCopy>. Files outside song folder needing copy on save. */
  pendingCopies: Map<number, PendingCopy>;
}

interface EditorState {
  past: EditorSnapshot[];
  current: EditorSnapshot | null;
  future: EditorSnapshot[];
  /** Last saved snapshot. Used to compute `isDirty`. */
  baseline: EditorSnapshot | null;
}

/** Cap on how far back undo / forward redo can walk. */
const HISTORY_LIMIT = 50;

const EMPTY_EDITOR: EditorState = {
  past: [],
  current: null,
  future: [],
  baseline: null,
};

export function SongEditor({ jcsPath }: Props) {
  const { state, dispatch, rescan } = useAppState();

  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [trackMap, setTrackMap] = useState<TrackMap | null>(null);
  const [trackMapSource, setTrackMapSource] = useState<string | null>(null);
  const [longestFilename, setLongestFilename] = useState<string | null>(null);
  /**
   * The song folder's WAV listing — used both to identify the longest
   * file and to surface per-channel rate-mismatch warnings in the grid.
   */
  const [folderFiles, setFolderFiles] = useState<AudioFileInfo[]>([]);

  const draftSong = editor.current?.song ?? null;

  const songFolder = useMemo(
    () => jcsPath.replace(/\/[^/]+\.jcs$/i, ""),
    [jcsPath],
  );
  const songName = useMemo(
    () => songFolder.split("/").pop() ?? "(unknown)",
    [songFolder],
  );

  const labels = useMemo(() => {
    const result: string[] = [];
    for (let i = 0; i < TRACK_MAP_CHANNEL_COUNT; i++) {
      const fromMap = trackMap?.channels[i];
      result.push(fromMap && fromMap.length > 0 ? fromMap : `Ch ${i + 1}`);
    }
    return result;
  }, [trackMap]);

  // ---- Snapshot mutators (undo-aware) -------------------------------------

  /**
   * Apply an edit to the current snapshot, recording the previous one
   * onto the undo stack and clearing the redo stack.
   */
  const applyEdit = useCallback(
    (updater: (snapshot: EditorSnapshot) => EditorSnapshot) => {
      setEditor((e) => {
        if (!e.current) return e;
        const next = updater(e.current);
        // Skip recording if nothing actually changed.
        if (
          writeSong(next.song) === writeSong(e.current.song) &&
          mapsEqual(next.pendingCopies, e.current.pendingCopies)
        ) {
          return e;
        }
        return {
          past: [...e.past, e.current].slice(-HISTORY_LIMIT),
          current: next,
          future: [], // any new edit invalidates the redo stack
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

  // ---- Load .jcs on mount / when jcsPath changes --------------------------
  useEffect(() => {
    let cancelled = false;
    setEditor(EMPTY_EDITOR);
    setLoadError(null);
    setSaveError(null);
    (async () => {
      try {
        const text = await readTextFile(jcsPath);
        const parsed = parseSong(text);
        if (cancelled) return;
        const initialSnapshot: EditorSnapshot = {
          song: parsed,
          pendingCopies: new Map(),
        };
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
  }, [jcsPath]);

  // ---- Probe the song folder ---------------------------------------------
  // Stored on state because both the longest-file detection AND the
  // per-channel rate-mismatch flagging need this listing.
  useEffect(() => {
    if (!draftSong) return;
    let cancelled = false;
    listAudioFiles(songFolder)
      .then((list) => {
        if (cancelled) return;
        setFolderFiles(list);
        // Recompute longest while we have the list.
        const assigned = new Set(draftSong.audioFiles.map((f) => f.filename));
        let longest: { name: string; samples: number } | null = null;
        for (const f of list) {
          if (f.kind !== "wav") continue;
          if (!assigned.has(f.filename)) continue;
          const samples = f.wavInfo?.durationSamples ?? 0;
          if (longest === null || samples > longest.samples) {
            longest = { name: f.filename, samples };
          }
        }
        setLongestFilename(longest?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setFolderFiles([]);
          setLongestFilename(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draftSong, songFolder]);

  /**
   * Per-channel sample-rate map. For each audio file in the song:
   *   - If the channel has a pendingCopy (file lives outside the song
   *     folder, queued for save), use the rate captured at click time.
   *   - Else, look up the file by name in the song folder's listing.
   *
   * Channels with no entry have an unknown rate — usually means the
   * folder probe hasn't completed yet, or the assigned filename
   * doesn't actually exist on disk.
   */
  const channelSampleRates = useMemo(() => {
    const m = new Map<number, number>();
    if (!draftSong || !editor.current) return m;
    const byName = new Map<string, AudioFileInfo>();
    for (const f of folderFiles) byName.set(f.filename, f);
    for (const audio of draftSong.audioFiles) {
      const pending = editor.current.pendingCopies.get(audio.channel);
      if (pending) {
        m.set(audio.channel, pending.sampleRate);
        continue;
      }
      const probed = byName.get(audio.filename);
      const rate = probed?.wavInfo?.sampleRate;
      if (rate !== undefined && rate > 0) {
        m.set(audio.channel, rate);
      }
    }
    return m;
  }, [draftSong, editor, folderFiles]);

  // ---- Auto-load the first track map --------------------------------------
  useEffect(() => {
    if (trackMap || state.scan.trackMaps.length === 0) return;
    const first = state.scan.trackMaps[0]!;
    void (async () => {
      try {
        const text = await readTextFile(first.path);
        setTrackMap(parseTrackMap(text));
        setTrackMapSource(first.path);
      } catch {
        // No track map → grid still works, shows "Ch 1 / Ch 2 / …"
      }
    })();
  }, [trackMap, state.scan.trackMaps]);

  const onPickTrackMap = async (path: string) => {
    if (path === trackMapSource) return;
    try {
      const text = await readTextFile(path);
      setTrackMap(parseTrackMap(text));
      setTrackMapSource(path);
    } catch (e) {
      void e;
    }
  };

  // ---- Edit handlers ------------------------------------------------------

  const handleSampleRateChange = useCallback(
    (sampleRate: number) => {
      applyEdit((snap) => ({
        ...snap,
        song: { ...snap.song, sampleRate },
      }));
    },
    [applyEdit],
  );

  const handleSelectChannel = useCallback(
    (channel: number | null) => {
      dispatch({ type: "select_channel", channel });
    },
    [dispatch],
  );

  const handleSelectSourceFile = useCallback(
    (file: AudioFileInfo) => {
      const channelSel = state.channelSelection;

      if (file.kind === "wav") {
        const isStereo = (file.wavInfo?.channels ?? 1) > 1;
        const isHardError = file.diagnostic?.severity === "error";
        if (isStereo || isHardError) return;
      }

      const targetChannel =
        file.kind === "mid" ? MIDI_CHANNEL_INDEX : channelSel;
      if (targetChannel === null) return;

      const isInSongFolder = file.path.startsWith(`${songFolder}/`);

      applyEdit((snap) => {
        let nextSong: Song;
        if (file.kind === "mid") {
          const midi: SongMidiFile = {
            filename: file.filename,
            channel: MIDI_CHANNEL_INDEX,
          };
          nextSong = { ...snap.song, midiFile: midi };
        } else {
          const next: SongAudioFile = {
            filename: file.filename,
            channel: targetChannel,
            level: 1.0,
            pan: 0.5,
            mute: 1.0,
          };
          const remaining = snap.song.audioFiles.filter(
            (f) => f.channel !== targetChannel,
          );
          const reassigned = [...remaining, next].sort(
            (a, b) => a.channel - b.channel,
          );
          nextSong = { ...snap.song, audioFiles: reassigned };
        }
        const nextCopies = new Map(snap.pendingCopies);
        if (isInSongFolder) {
          nextCopies.delete(targetChannel);
        } else {
          nextCopies.set(targetChannel, {
            sourcePath: file.path,
            filename: file.filename,
            sampleRate: file.wavInfo?.sampleRate ?? 0,
          });
        }
        return { song: nextSong, pendingCopies: nextCopies };
      });
    },
    [applyEdit, songFolder, state.channelSelection],
  );

  const handleClearChannel = useCallback(() => {
    const channel = state.channelSelection;
    if (channel === null) return;
    applyEdit((snap) => {
      const nextSong: Song =
        channel === MIDI_CHANNEL_INDEX
          ? { ...snap.song, midiFile: undefined }
          : {
              ...snap.song,
              audioFiles: snap.song.audioFiles.filter(
                (f) => f.channel !== channel,
              ),
            };
      const nextCopies = new Map(snap.pendingCopies);
      nextCopies.delete(channel);
      return { song: nextSong, pendingCopies: nextCopies };
    });
  }, [applyEdit, state.channelSelection]);

  // ---- Dirty check -------------------------------------------------------
  const isDirty = useMemo(() => {
    if (!editor.current || !editor.baseline) return false;
    return (
      writeSong(editor.current.song) !== writeSong(editor.baseline.song) ||
      editor.current.pendingCopies.size > 0
    );
  }, [editor]);

  const canUndo = editor.past.length > 0;
  const canRedo = editor.future.length > 0;

  // ---- Save --------------------------------------------------------------
  // Capture latest state in a ref so the keydown listener reads fresh values
  // without re-binding the listener on every keystroke.
  const saveStateRef = useRef({
    snapshot: editor.current,
    songFolder,
    isDirty,
    saving,
    jcsPath,
    songName,
  });
  saveStateRef.current = {
    snapshot: editor.current,
    songFolder,
    isDirty,
    saving,
    jcsPath,
    songName,
  };

  const handleSave = useCallback(async () => {
    const s = saveStateRef.current;
    if (!s.snapshot || s.saving || !s.isDirty) return;

    // Native confirm dialog (Tauri's plugin-dialog → real macOS NSAlert).
    const confirmed = await ask(
      `Save changes to "${s.songName}"?\n\nThis will overwrite the existing .jcs file` +
        (s.snapshot.pendingCopies.size > 0
          ? ` and copy ${s.snapshot.pendingCopies.size} new file(s) into the song folder.`
          : "."),
      {
        title: "Save Song",
        kind: "info",
        okLabel: "Save",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;

    setSaving(true);
    setSaveError(null);
    try {
      // 1. Copy any pending files into the song folder
      for (const { sourcePath } of s.snapshot.pendingCopies.values()) {
        await copyIntoFolder(sourcePath, s.songFolder);
      }

      // 2. Recompute lengthSamples from the longest WAV in the assigned set
      const list = await listAudioFiles(s.songFolder);
      const assigned = new Set(s.snapshot.song.audioFiles.map((f) => f.filename));
      let maxSamples = 0;
      let newLongest: string | null = null;
      for (const f of list) {
        if (f.kind !== "wav") continue;
        if (!assigned.has(f.filename)) continue;
        const samples = f.wavInfo?.durationSamples ?? 0;
        if (samples > maxSamples) {
          maxSamples = samples;
          newLongest = f.filename;
        }
      }
      const finalSong: Song = { ...s.snapshot.song, lengthSamples: maxSamples };

      // 3. Write the .jcs
      const text = writeSong(finalSong);
      await writeTextFile(s.jcsPath, text);

      // 4. New baseline = current state (with the recomputed length).
      //    We DON'T clear past/future — undo across save is allowed.
      setEditor((e) => {
        const newCurrent: EditorSnapshot = {
          song: finalSong,
          pendingCopies: new Map(),
        };
        return {
          past: e.past,
          current: newCurrent,
          future: e.future,
          baseline: newCurrent,
        };
      });
      setLongestFilename(newLongest);

      // 5. Refresh the working-folder scan
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

      // Cmd+S — save
      if (meta && key === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }
      // Cmd+Z (no shift) — undo
      // Cmd+Shift+Z or Cmd+Y — redo
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
      // Delete / Backspace — clear selected channel's assignment
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
        if (state.channelSelection !== null) {
          e.preventDefault();
          handleClearChannel();
        }
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [handleSave, handleClearChannel, undo, redo, state.channelSelection]);

  // ---- Render -------------------------------------------------------------

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col bg-white p-12 dark:bg-zinc-950">
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          Failed to load song: {loadError}
        </p>
      </main>
    );
  }

  if (!draftSong) {
    return (
      <main className="flex flex-1 items-center justify-center bg-white dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <SongHeader
        songName={songName}
        sampleRate={draftSong.sampleRate}
        durationSamples={draftSong.lengthSamples}
        trackMaps={state.scan.trackMaps}
        trackMapPath={trackMapSource}
        onPickTrackMap={onPickTrackMap}
        fileCount={draftSong.audioFiles.length + (draftSong.midiFile ? 1 : 0)}
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

      <div className="flex flex-1 overflow-hidden">
        <ChannelGrid
          song={draftSong}
          channelLabels={labels}
          longestFilename={longestFilename}
          longestDurationSeconds={
            draftSong.lengthSamples / draftSong.sampleRate
          }
          channelSampleRates={channelSampleRates}
          selectedChannel={state.channelSelection}
          onSelectChannel={handleSelectChannel}
        />
        <SourceFilesPane
          songFolder={songFolder}
          songSampleRate={draftSong.sampleRate}
          channelSelected={state.channelSelection !== null}
          onSelectFile={handleSelectSourceFile}
        />
      </div>
    </main>
  );
}

/** Shallow equal check for the small pendingCopies maps (≤25 entries). */
function mapsEqual(
  a: Map<number, PendingCopy>,
  b: Map<number, PendingCopy>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w) return false;
    if (v.sourcePath !== w.sourcePath || v.filename !== w.filename) return false;
  }
  return true;
}
