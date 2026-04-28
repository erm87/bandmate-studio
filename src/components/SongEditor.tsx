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
import { ask, message } from "@tauri-apps/plugin-dialog";
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
  readSongSidecar,
  readTextFile,
  writeSongSidecar,
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

/** Maximum audio channel index (exclusive bound for cascade scans). */
const AUDIO_CHANNEL_MAX = MIDI_CHANNEL_INDEX; // 24

/**
 * Compute a cascade shift to make room at `target` by sliding the
 * occupied block of channels in `direction` toward the nearest empty
 * slot.
 *
 * Returns:
 *   - `null` if no empty slot exists in the requested direction
 *     (caller should refuse the drop and surface an alert).
 *   - Otherwise, the new audio + pending-copies maps with target now
 *     empty, ready for the caller to place a file there.
 *
 * `treatAsEmpty` is the source channel for `channel-move` drops —
 * its slot is about to be vacated, so the cascade can use it as an
 * empty slot. Pass `undefined` for source-file drops (no source).
 *
 * Algorithm: scan from `target ± 1` in `direction` until an empty
 * channel is found, then shift every occupied channel in the contiguous
 * block between target and that empty slot by one toward the empty
 * one. If the block reaches a hard boundary (channel 0 or 23 for
 * audio) without an empty slot, return null.
 */
function cascadeShift(
  audioFiles: SongAudioFile[],
  pendingCopies: Map<number, PendingCopy>,
  target: number,
  direction: -1 | 1,
  treatAsEmpty?: number,
): {
  audioFiles: SongAudioFile[];
  pendingCopies: Map<number, PendingCopy>;
} | null {
  const occupied = new Set(audioFiles.map((f) => f.channel));
  if (treatAsEmpty !== undefined) occupied.delete(treatAsEmpty);

  // Find the first empty channel in `direction` from `target`.
  let empty = -1;
  if (direction === -1) {
    for (let i = target - 1; i >= 0; i--) {
      if (!occupied.has(i)) {
        empty = i;
        break;
      }
    }
  } else {
    for (let i = target + 1; i < AUDIO_CHANNEL_MAX; i++) {
      if (!occupied.has(i)) {
        empty = i;
        break;
      }
    }
  }
  if (empty === -1) return null;

  // Build the cascade range. Channels in this range slide by `direction`
  // toward the empty slot, ending at slots [empty, target ∓ 1] and
  // leaving target itself empty for the caller.
  //
  // direction = -1 (shiftUp):
  //   range = [empty + 1, target]; each channel becomes channel - 1
  // direction = +1 (shiftDown):
  //   range = [target, empty - 1]; each channel becomes channel + 1
  const inRange = (ch: number) =>
    direction === -1
      ? ch >= empty + 1 && ch <= target
      : ch >= target && ch <= empty - 1;

  const newAudio = audioFiles
    .filter((f) => f.channel !== treatAsEmpty)
    .map((f) =>
      inRange(f.channel) ? { ...f, channel: f.channel + direction } : f,
    );

  const newPending = new Map<number, PendingCopy>();
  for (const [ch, copy] of pendingCopies) {
    if (ch === treatAsEmpty) continue; // caller re-keys this if needed
    const newCh = inRange(ch) ? ch + direction : ch;
    newPending.set(newCh, copy);
  }

  return { audioFiles: newAudio, pendingCopies: newPending };
}

/** Translates a DropMode shift to a cascade `direction` (or null for replace). */
function shiftDirection(mode: "replace" | "shiftUp" | "shiftDown"): -1 | 1 | null {
  if (mode === "shiftUp") return -1;
  if (mode === "shiftDown") return 1;
  return null;
}

/** User-facing alert text when a cascade has no empty slot to land in. */
const NO_EMPTY_CHANNEL_MESSAGE =
  "No empty channels available in that direction.\n\n" +
  "Drop the file directly on the channel row to replace the existing one, " +
  "or remove an existing file elsewhere in the list first to make room.";

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
  /**
   * External source folder for unimported WAVs. Loaded from the song's
   * `.bandmate-studio.json` sidecar on mount, persisted on change.
   * `null` = no external source set; the source pane shows the song
   * folder instead.
   */
  const [sourceFolder, setSourceFolder] = useState<string | null>(null);

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
    setSourceFolder(null);
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
        // Sidecar is best-effort — never fail the editor open over it.
        try {
          const sidecar = await readSongSidecar(songFolder);
          if (!cancelled && typeof sidecar.sourceFolder === "string") {
            setSourceFolder(sidecar.sourceFolder);
          }
        } catch {
          /* swallow — older songs have no sidecar */
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jcsPath, songFolder]);

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
    /**
     * Assign a source file to a channel.
     *
     * - For click-to-assign (the default), `channelOverride` is
     *   undefined and we use the highlighted channel from AppState.
     * - For drag-drop, the caller passes the explicit channel that
     *   the file was dropped on; `mode` controls how an existing
     *   assignment at the target is handled (see the DropMode docs).
     */
    (
      file: AudioFileInfo,
      channelOverride?: number,
      mode: "replace" | "shiftUp" | "shiftDown" = "replace",
    ) => {
      const channelSel = channelOverride ?? state.channelSelection;

      if (file.kind === "wav") {
        const isStereo = (file.wavInfo?.channels ?? 1) > 1;
        const isHardError = file.diagnostic?.severity === "error";
        if (isStereo || isHardError) return;
      }

      const targetChannel =
        file.kind === "mid" ? MIDI_CHANNEL_INDEX : channelSel;
      if (targetChannel === null) return;

      const isInSongFolder = file.path.startsWith(`${songFolder}/`);

      // Resolve cascade up front so we can refuse the drop with an
      // alert if no empty slot exists in the shift direction. We
      // can't do this inside applyEdit because applyEdit can't be
      // async (the alert is async).
      const direction = shiftDirection(mode);
      if (file.kind === "wav" && direction !== null) {
        const cascade = cascadeShift(
          editor.current?.song.audioFiles ?? [],
          editor.current?.pendingCopies ?? new Map(),
          targetChannel,
          direction,
        );
        if (cascade === null) {
          void message(NO_EMPTY_CHANNEL_MESSAGE, {
            title: "Can't shift",
            kind: "warning",
          });
          return;
        }
      }

      applyEdit((snap) => {
        let nextSong: Song;
        let nextCopies = new Map(snap.pendingCopies);
        if (file.kind === "mid") {
          const midi: SongMidiFile = {
            filename: file.filename,
            channel: MIDI_CHANNEL_INDEX,
          };
          nextSong = { ...snap.song, midiFile: midi };
        } else {
          let audioFiles = snap.song.audioFiles;
          if (direction !== null) {
            // Cascade: shift the contiguous block in `direction` to
            // open up `target`. We re-run cascade against the latest
            // snapshot rather than reusing the precheck result, since
            // applyEdit is the source of truth for state transitions.
            const cascade = cascadeShift(
              snap.song.audioFiles,
              snap.pendingCopies,
              targetChannel,
              direction,
            );
            if (cascade) {
              audioFiles = cascade.audioFiles;
              nextCopies = cascade.pendingCopies;
            }
            // else (shouldn't happen — we precheck) → fall through to replace.
          }
          const newAudio: SongAudioFile = {
            filename: file.filename,
            channel: targetChannel,
            level: 1.0,
            pan: 0.5,
            mute: 1.0,
          };
          const remaining = audioFiles.filter(
            (f) => f.channel !== targetChannel,
          );
          const reassigned = [...remaining, newAudio].sort(
            (a, b) => a.channel - b.channel,
          );
          nextSong = { ...snap.song, audioFiles: reassigned };
        }
        if (file.kind === "wav") {
          if (isInSongFolder) {
            nextCopies.delete(targetChannel);
          } else {
            nextCopies.set(targetChannel, {
              sourcePath: file.path,
              filename: file.filename,
              sampleRate: file.wavInfo?.sampleRate ?? 0,
            });
          }
        }
        return { song: nextSong, pendingCopies: nextCopies };
      });
    },
    [applyEdit, editor, songFolder, state.channelSelection],
  );

  /**
   * Move an existing channel assignment to another channel (drag-drop
   * reorganization). The audio file's level / pan / mute travel with
   * it.
   *
   * `mode` controls how an existing file at the target is handled:
   *
   *   - `replace` (drop in row middle): existing target file is
   *     discarded — matches drop-replaces semantics from most DAWs.
   *   - `shiftUp` (drop on row's top edge): existing target moves to
   *     `to - 1` if that slot is empty + in bounds; otherwise falls
   *     back to replace.
   *   - `shiftDown` (drop on row's bottom edge): same with `to + 1`.
   *
   * Pending copies (files queued for save-time copy) move with the
   * assignment too, so the queue stays consistent.
   *
   * MIDI's slot is fixed at index 24, so we no-op any move involving
   * the MIDI slot — there's nowhere else MIDI could go.
   */
  const handleMoveChannel = useCallback(
    (from: number, to: number, mode: "replace" | "shiftUp" | "shiftDown") => {
      if (from === to) return;
      if (from === MIDI_CHANNEL_INDEX || to === MIDI_CHANNEL_INDEX) return;
      const fromFile = editor.current?.song.audioFiles.find(
        (f) => f.channel === from,
      );
      if (!fromFile) return;

      // Pre-check cascade feasibility for shift modes. The source
      // channel counts as empty (it's about to be vacated), so the
      // cascade has one extra empty slot to work with.
      const direction = shiftDirection(mode);
      if (direction !== null) {
        const cascade = cascadeShift(
          editor.current?.song.audioFiles ?? [],
          editor.current?.pendingCopies ?? new Map(),
          to,
          direction,
          /* treatAsEmpty */ from,
        );
        if (cascade === null) {
          void message(NO_EMPTY_CHANNEL_MESSAGE, {
            title: "Can't shift",
            kind: "warning",
          });
          return;
        }
      }

      applyEdit((snap) => {
        let audioFiles = snap.song.audioFiles;
        let nextCopies = new Map(snap.pendingCopies);
        if (direction !== null) {
          const cascade = cascadeShift(
            snap.song.audioFiles,
            snap.pendingCopies,
            to,
            direction,
            /* treatAsEmpty */ from,
          );
          if (cascade) {
            audioFiles = cascade.audioFiles;
            nextCopies = cascade.pendingCopies;
            // cascadeShift dropped any pending copy keyed by `from`
            // (it's about to be re-keyed below).
          } else {
            // Shouldn't happen — we precheck. Fall back to replace
            // and remove the source explicitly.
            audioFiles = audioFiles.filter((f) => f.channel !== from);
            nextCopies.delete(from);
          }
        } else {
          // Replace mode: drop the source file from the array now;
          // the target's existing file is filtered out below.
          audioFiles = audioFiles.filter((f) => f.channel !== from);
          nextCopies.delete(from);
        }
        // Place the moved file at `to`, replacing anything still there.
        const remaining = audioFiles.filter((f) => f.channel !== to);
        const moved = { ...fromFile, channel: to };
        const nextAudio = [...remaining, moved].sort(
          (a, b) => a.channel - b.channel,
        );
        // Re-key the source's pending copy from `from` to `to`.
        const sourceCopy = snap.pendingCopies.get(from);
        nextCopies.delete(to); // drop stale entry at target if any
        if (sourceCopy) nextCopies.set(to, sourceCopy);
        return {
          song: { ...snap.song, audioFiles: nextAudio },
          pendingCopies: nextCopies,
        };
      });
    },
    [applyEdit, editor],
  );

  /**
   * Update the per-song source folder — both in local state (for the
   * source pane) and in the on-disk sidecar (so it persists). Failures
   * are surfaced via saveError; we don't want a silent persistence
   * miss but it shouldn't block the editor.
   */
  const handleChangeSourceFolder = useCallback(
    (path: string | null) => {
      setSourceFolder(path);
      void writeSongSidecar(songFolder, { sourceFolder: path }).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setSaveError(`Source folder didn't persist: ${msg}`);
      });
    },
    [songFolder],
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
          onDropFile={(file, channel, mode) =>
            handleSelectSourceFile(file, channel, mode)
          }
          onMoveChannel={handleMoveChannel}
        />
        <SourceFilesPane
          songFolder={songFolder}
          sourceFolder={sourceFolder}
          songSampleRate={draftSong.sampleRate}
          channelSelected={state.channelSelection !== null}
          onSelectFile={handleSelectSourceFile}
          onChangeSourceFolder={(path) => handleChangeSourceFolder(path)}
          onClearSourceFolder={() => handleChangeSourceFolder(null)}
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
