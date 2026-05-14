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
  cleanMidiFile,
  copyIntoFolder,
  deleteFilesInSongFolder,
  duplicateSong,
  listAudioFiles,
  readSongSidecar,
  readTextFile,
  writeSongSidecar,
  writeTextFile,
} from "../fs/workingFolder";
import { classifySongFolderFiles, suggestDuplicateName } from "../lib/references";
import { bestChannelForFilename } from "../lib/sourceMatch";
import { diffSongs } from "../lib/snapshotDiff";
import type { AudioFileInfo } from "../fs/types";
import { useAppState } from "../state/AppState";
import { ChannelGrid, type ChannelChange } from "./ChannelGrid";
import { CleanupConfirmDialog } from "./CleanupConfirmDialog";
import { SaveConfirmDialog } from "./SaveConfirmDialog";
import {
  SmartImportConfirmDialog,
  type ProposedReplacement,
} from "./SmartImportConfirmDialog";
import { SongHeader } from "./SongHeader";
import { SourceFilesPane } from "./SourceFilesPane";
import { Toast } from "./Toast";
import { UndoHistoryPanel } from "./UndoHistoryPanel";

interface Props {
  jcsPath: string;
}

interface PendingCopy {
  sourcePath: string;
  filename: string;
  /**
   * The WAV's metadata at click time. Captured here because the file
   * isn't yet in the song folder, so the song-folder probe doesn't
   * know about it. Used both to flag rate-mismatch in the channel
   * grid AND to populate the row tooltip / drag-image label with the
   * track's spec line ("44.1 kHz · mono · 3:21").
   *
   * MIDI pending copies (keyed at MIDI_CHANNEL_INDEX) populate these
   * with zeros — the channel-meta UI only iterates `audioFiles` so
   * the zero values never reach a render path. The save loop reads
   * only `sourcePath` so the metadata fields don't matter for the
   * actual copy.
   */
  sampleRate: number;
  channels: number;
  durationSeconds: number;
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

/**
 * Snapshot of a partially-decided Import-all run, paused while the
 * user reviews proposed replacements in `SmartImportConfirmDialog`.
 *
 * The bucketing is finalized at the moment `handleImportAll` hands
 * control to the dialog — every file's destination is already known
 * except for the user's checkbox decisions on replacements. The
 * commit step (`commitImport`) merges those decisions into the
 * pre-computed buckets and performs the eager-copy + applyEdit.
 *
 * Keeping the full bucket state out-of-tree (here, not in the
 * dialog) lets the dialog stay pure and the commit run identically
 * regardless of whether it was triggered by the no-dialog path,
 * Confirm, or Import-without-auto-mapping.
 */
interface PendingImport {
  /**
   * Empty-channel fuzzy-match winners. Auto-applied on Confirm OR
   * on the no-dialog fast path; ignored on Import-without-auto-mapping.
   */
  newAudioByChannel: Map<number, AudioFileInfo>;
  /**
   * Empty MIDI slot winner. Same treatment as `newAudioByChannel`
   * but for the MIDI slot. `null` when the slot is occupied or
   * no MIDI files are in the import.
   */
  newMidi: AudioFileInfo | null;
  /**
   * Replacement candidates surfaced in the dialog. Empty in the no-
   * dialog fast path. Keyed by channel index (0..23 audio, 24 MIDI)
   * so the dialog's Set<number> result maps back to file lookups
   * via `replacementFileByChannel`.
   */
  replacements: ProposedReplacement[];
  /**
   * Resolution table for the replacement decisions. `commitImport`
   * uses this to find the AudioFileInfo to apply/copy for each
   * accepted channel index.
   */
  replacementFileByChannel: Map<number, AudioFileInfo>;
  /**
   * Files that didn't match any channel — copy into song folder
   * unassigned. Same as today's direct-copy bucket.
   */
  directCopy: AudioFileInfo[];
  /**
   * Count of source files that were already in the song folder
   * (skipped from import entirely). Surfaced in the toast when
   * nothing else was imported.
   */
  alreadyInSongCount: number;
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

/**
 * Module-level cache of the most-recently-loaded trackmap. Outlives
 * SongEditor's mount lifecycle so that navigating between songs that
 * use the same trackmap doesn't flicker through "no selection" before
 * the sidecar/auto-pick resolves. The new editor instance initializes
 * its trackmap state from this cache; if the new song's sidecar
 * preference differs, the dropdown then transitions to the right
 * value — a legitimate visual change rather than a glitch.
 *
 * Reset implicitly when the cached path is no longer in the current
 * scan (e.g., user switched working folders).
 */
let cachedTrackMap: {
  path: string;
  filename: string;
  map: TrackMap;
} | null = null;

/** Translates a DropMode shift to a cascade `direction` (or null for replace). */
function shiftDirection(mode: "replace" | "shiftUp" | "shiftDown"): -1 | 1 | null {
  if (mode === "shiftUp") return -1;
  if (mode === "shiftDown") return 1;
  return null;
}

/** User-facing alert text when a cascade has no empty slot to land in. */
/**
 * If `cleanMidiOnImport` is true and `path` ends with a MIDI extension,
 * run the cleaner on it. Failures are swallowed (logged) — we don't
 * want a botched clean to abort an otherwise-successful save.
 *
 * Hook is invoked after each `copyIntoFolder` in the save flow so the
 * working-folder copy is the cleaned one; the source file is never
 * touched.
 */
async function maybeAutoCleanMidi(
  destPath: string,
  cleanMidiOnImport: boolean,
): Promise<void> {
  if (!cleanMidiOnImport) return;
  const lower = destPath.toLowerCase();
  if (!lower.endsWith(".mid") && !lower.endsWith(".midi")) return;
  try {
    await cleanMidiFile(destPath);
  } catch (e) {
    console.error(`Auto-clean failed for ${destPath}:`, e);
  }
}

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
  const { state, dispatch, rescan, registerDirtyEditor } = useAppState();

  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Initialize from the module cache so navigating between songs that
  // share a trackmap doesn't flicker through the default state. The
  // cached value is only honored if it still exists in the current
  // scan — otherwise we fall back to null and the auto-pick/sidecar
  // load decides what to show.
  const cachedStillValid =
    cachedTrackMap !== null &&
    state.scan.trackMaps.some((t) => t.path === cachedTrackMap!.path);
  const [trackMap, setTrackMap] = useState<TrackMap | null>(
    () => (cachedStillValid ? cachedTrackMap!.map : null),
  );
  const [trackMapSource, setTrackMapSource] = useState<string | null>(
    () => (cachedStillValid ? cachedTrackMap!.path : null),
  );

  // Keep the cache in sync with the latest in-component selection.
  useEffect(() => {
    if (trackMap && trackMapSource) {
      const filename = trackMapSource.split("/").pop() ?? "";
      cachedTrackMap = { path: trackMapSource, filename, map: trackMap };
    }
  }, [trackMap, trackMapSource]);
  const [longestFilename, setLongestFilename] = useState<string | null>(null);
  /**
   * Counter bumped after save / save-as / manual MIDI clean. Threaded
   * to SourceFilesPane's Song Folder tab so its file listing (and any
   * cleanliness badges) re-fetch after the song folder mutates.
   * Without this the tab keeps stale "Not clean" pills on files that
   * were just cleaned in place.
   */
  const [songFolderRefreshKey, setSongFolderRefreshKey] = useState(0);
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
  /**
   * Cleanup confirm dialog state. `null` = closed. When set, holds the
   * filenames pulled in at click time so the user sees a stable list
   * even if a background refresh changes `folderFiles` mid-dialog.
   *
   * We snapshot the unreferenced list at button-click time rather than
   * computing it inside the dialog so a parallel file-list refresh
   * can't shift items out from under the confirmation.
   */
  const [cleanupCandidates, setCleanupCandidates] = useState<
    AudioFileInfo[] | null
  >(null);
  /**
   * Pending Import-all decision state. `null` = no dialog open.
   *
   * Populated by `handleImportAll` when Smart Mapping finds at least
   * one fuzzy-match that would replace an already-assigned channel.
   * The bucketing is fully computed up-front so dialog approval is
   * a pure "yes/no per channel" decision — no re-fetching, no re-
   * scoring, no race against folder-listing refreshes. Cleared when
   * the dialog closes (commit, override, or cancel).
   *
   * For the no-replacement case (the common path on first imports),
   * `handleImportAll` calls `commitImport` directly and never sets
   * this state — preserves the friction-free flow per the design
   * step's "replacements only" decision.
   */
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(
    null,
  );
  /**
   * Single-slot non-blocking toast. Currently set by the Import-all
   * flow to communicate counts; rendered at the bottom-right of the
   * editor pane via `<Toast>` and auto-dismisses after a few seconds.
   * If we add more transient notifications later, consider a queue
   * — single-slot is fine for the one current caller.
   */
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
      // Unlabeled channels render blank in the editor so the user's
      // eye lands on the channels their track-map actually defines.
      // The numeric channel index stays visible in the leading "CH"
      // column for reference.
      result.push(fromMap && fromMap.length > 0 ? fromMap : "");
    }
    return result;
  }, [trackMap]);

  /**
   * Per-channel file-assignment delta vs the editor's last-saved
   * baseline. Drives the small change-dot indicator in the channel
   * grid. Recomputed on every snapshot edit (the cost is trivial —
   * one pass over <=25 channels) and resets to empty on save, since
   * the save handler updates `baseline` to match `current`.
   *
   * Scope: file assignment only (filename for audio rows, midiFile
   * for the MIDI row). Per-channel Lvl / Pan / Mute tweaks are not
   * surfaced as dots — those are secondary edits and would clutter
   * the at-a-glance scan that's the whole point of this indicator.
   */
  const channelChanges = useMemo<Map<number, ChannelChange>>(() => {
    const m = new Map<number, ChannelChange>();
    const current = editor.current?.song;
    const baseline = editor.baseline?.song;
    if (!current || !baseline) return m;
    // Audio channels.
    const baseByCh = new Map<number, string>(
      baseline.audioFiles.map((f) => [f.channel, f.filename]),
    );
    const curByCh = new Map<number, string>(
      current.audioFiles.map((f) => [f.channel, f.filename]),
    );
    for (let ch = 0; ch < MIDI_CHANNEL_INDEX; ch++) {
      const before = baseByCh.get(ch);
      const after = curByCh.get(ch);
      if (before === after) continue;
      if (before && after) {
        m.set(ch, { kind: "replaced", before, after });
      } else if (after) {
        m.set(ch, { kind: "newly", after });
      } else if (before) {
        m.set(ch, { kind: "cleared", before });
      }
    }
    // MIDI slot.
    const baseMidi = baseline.midiFile?.filename;
    const curMidi = current.midiFile?.filename;
    if (baseMidi !== curMidi) {
      if (baseMidi && curMidi) {
        m.set(MIDI_CHANNEL_INDEX, {
          kind: "replaced",
          before: baseMidi,
          after: curMidi,
        });
      } else if (curMidi) {
        m.set(MIDI_CHANNEL_INDEX, { kind: "newly", after: curMidi });
      } else if (baseMidi) {
        m.set(MIDI_CHANNEL_INDEX, { kind: "cleared", before: baseMidi });
      }
    }
    return m;
  }, [editor.current, editor.baseline]);

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

  /**
   * Jump to a specific snapshot by its flat-list index. Used by the
   * Undo History panel — clicking an entry calls this with the
   * entry's index.
   *
   * Flat-list layout: [past[0], past[1], …, past[n-1], current,
   * future[0], future[1], …]. Slicing rebuilds the past / current /
   * future buckets so the snapshot at `targetIdx` becomes the new
   * `current`. Baseline carries through unchanged (it's a reference
   * to one of the snapshots in the flat list, which doesn't reorder).
   */
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
          if (cancelled) return;
          if (typeof sidecar.sourceFolder === "string") {
            setSourceFolder(sidecar.sourceFolder);
          }
          // Resolution order for the song's preview trackmap:
          //   1. Sidecar's previewTrackMap (user previously picked
          //      one for THIS song).
          //   2. userPrefs.defaultTrackMapJcm (their global default
          //      for any new song).
          //   3. Auto-pick effect below (first scanned trackmap) —
          //      the catch-all when neither preference applies or
          //      the referenced file doesn't exist.
          // Try (1), then (2). Each attempt validates the filename
          // against the current scan and re-parses the trackmap
          // content. Silent fall-through on any miss.
          const tryLoadTrackMapByFilename = async (
            filename: string | null | undefined,
          ): Promise<boolean> => {
            if (typeof filename !== "string" || filename.length === 0)
              return false;
            const tm = state.scan.trackMaps.find(
              (t) => t.filename === filename,
            );
            if (!tm) return false;
            try {
              const tmText = await readTextFile(tm.path);
              if (cancelled) return true; // suppress further attempts
              setTrackMap(parseTrackMap(tmText));
              setTrackMapSource(tm.path);
              return true;
            } catch {
              return false;
            }
          };

          const sidecarLoaded = await tryLoadTrackMapByFilename(
            sidecar.previewTrackMap,
          );
          if (!sidecarLoaded && !cancelled) {
            await tryLoadTrackMapByFilename(
              state.userPrefs.defaultTrackMapJcm,
            );
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
        // Recompute longest while we have the list. Considers BOTH
        // WAV and MIDI — must mirror performSave's max-duration loop
        // so the stopwatch icon in the channel grid points at the
        // same file as the one that determined the saved <length>.
        // (Smoke-test finding F-7: previously this loop was WAV-only,
        // so when a MIDI file was longer than every WAV the stopwatch
        // landed on the longest WAV instead of the MIDI row.)
        const assignedWavs = new Set(
          draftSong.audioFiles.map((f) => f.filename),
        );
        const assignedMidi = draftSong.midiFile?.filename ?? null;
        const songRate = draftSong.sampleRate;
        let longest: { name: string; samples: number } | null = null;
        for (const f of list) {
          const isAssignedWav =
            f.kind === "wav" && assignedWavs.has(f.filename);
          const isAssignedMidi =
            f.kind === "mid" && assignedMidi === f.filename;
          if (!isAssignedWav && !isAssignedMidi) continue;
          const samples = Math.round(
            (f.durationSeconds ?? 0) * songRate,
          );
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
   * Per-channel WAV metadata, keyed by channel index. For each audio
   * file in the song:
   *   - If the channel has a pendingCopy (file lives outside the song
   *     folder, queued for save), use the metadata captured at click
   *     time.
   *   - Else, look up the file by name in the song folder's listing.
   *
   * Channels with no entry have unknown metadata — usually the
   * folder probe hasn't completed yet, or the assigned filename
   * doesn't actually exist on disk.
   *
   * Used for: rate-mismatch flag (sampleRate vs songRate), row
   * tooltips ("44.1 kHz · mono · 3:21"), and drag-image label.
   */
  const channelMeta = useMemo(() => {
    const m = new Map<
      number,
      { sampleRate: number; channels: number; durationSeconds: number }
    >();
    if (!draftSong || !editor.current) return m;
    const byName = new Map<string, AudioFileInfo>();
    for (const f of folderFiles) byName.set(f.filename, f);
    for (const audio of draftSong.audioFiles) {
      const pending = editor.current.pendingCopies.get(audio.channel);
      if (pending) {
        m.set(audio.channel, {
          sampleRate: pending.sampleRate,
          channels: pending.channels,
          durationSeconds: pending.durationSeconds,
        });
        continue;
      }
      const probed = byName.get(audio.filename);
      const wav = probed?.wavInfo;
      if (wav && wav.sampleRate > 0) {
        m.set(audio.channel, {
          sampleRate: wav.sampleRate,
          channels: wav.channels,
          durationSeconds: wav.durationSeconds,
        });
      }
    }
    return m;
  }, [draftSong, editor, folderFiles]);

  /**
   * Channel sample rate only — the legacy view used by the
   * rate-mismatch flag in the channel grid header. Derived from
   * `channelMeta` so we have a single source of truth.
   */
  const channelSampleRates = useMemo(() => {
    const m = new Map<number, number>();
    for (const [ch, meta] of channelMeta) m.set(ch, meta.sampleRate);
    return m;
  }, [channelMeta]);

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
      // Persist the choice as a Studio-only preview preference (sidecar
      // field `previewTrackMap`). The BandMate hardware never reads
      // this — playback labels come from the playlist's <trackmap>.
      // Immediate-persist (no Save button needed) mirrors the
      // sourceFolder pattern; the trackmap is a UI preview pref, not
      // part of the song's content.
      const filename = path.split("/").pop() ?? "";
      void updateSidecar({ previewTrackMap: filename });
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
        // Track files outside the song folder so performSave can copy
        // them in. Same logic for WAV and MIDI: in-folder → no-op
        // (file is already in place); out-of-folder → record a
        // pendingCopy keyed by the target channel.
        if (file.kind === "wav") {
          if (isInSongFolder) {
            nextCopies.delete(targetChannel);
          } else {
            nextCopies.set(targetChannel, {
              sourcePath: file.path,
              filename: file.filename,
              sampleRate: file.wavInfo?.sampleRate ?? 0,
              channels: file.wavInfo?.channels ?? 1,
              durationSeconds: file.wavInfo?.durationSeconds ?? 0,
            });
          }
        } else if (file.kind === "mid") {
          if (isInSongFolder) {
            nextCopies.delete(targetChannel);
          } else {
            nextCopies.set(targetChannel, {
              sourcePath: file.path,
              filename: file.filename,
              // MIDI has no audio metadata; zeros are sentinels
              // (never rendered — see PendingCopy docstring).
              sampleRate: 0,
              channels: 0,
              durationSeconds: 0,
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
   * Swap the assignments at two channels (audio only — MIDI stays at
   * slot 24). Used by the on-row ↑ / ↓ buttons and the Cmd+Arrow
   * keyboard shortcuts. Distinct from `handleMoveChannel` which is
   * a one-way move with cascade-shift semantics; swap is symmetric
   * and doesn't touch any other channels.
   *
   * No-ops when either side is the MIDI slot or out of range, or
   * when both sides are empty (nothing to swap).
   */
  const handleSwapChannels = useCallback(
    (a: number, b: number) => {
      if (a === b) return;
      if (a === MIDI_CHANNEL_INDEX || b === MIDI_CHANNEL_INDEX) return;
      if (a < 0 || b < 0) return;
      if (a >= MIDI_CHANNEL_INDEX || b >= MIDI_CHANNEL_INDEX) return;
      applyEdit((snap) => {
        const fileA = snap.song.audioFiles.find((f) => f.channel === a);
        const fileB = snap.song.audioFiles.find((f) => f.channel === b);
        if (!fileA && !fileB) return snap;
        const others = snap.song.audioFiles.filter(
          (f) => f.channel !== a && f.channel !== b,
        );
        const updated = [...others];
        if (fileA) updated.push({ ...fileA, channel: b });
        if (fileB) updated.push({ ...fileB, channel: a });
        updated.sort((x, y) => x.channel - y.channel);
        // Swap pending-copy entries by re-keying.
        const nextPending = new Map(snap.pendingCopies);
        const copyA = nextPending.get(a);
        const copyB = nextPending.get(b);
        nextPending.delete(a);
        nextPending.delete(b);
        if (copyA) nextPending.set(b, copyA);
        if (copyB) nextPending.set(a, copyB);
        return {
          song: { ...snap.song, audioFiles: updated },
          pendingCopies: nextPending,
        };
      });
      // Selection follows the moved row so the user can chain swaps
      // without re-clicking.
      if (state.channelSelection === a) {
        dispatch({ type: "select_channel", channel: b });
      } else if (state.channelSelection === b) {
        dispatch({ type: "select_channel", channel: a });
      }
    },
    [applyEdit, dispatch, state.channelSelection],
  );

  /**
   * Merge-update the sidecar: read existing, overlay `partial`, write
   * the whole thing back. Required because `writeSongSidecar` overwrites
   * — without the merge a `sourceFolder` write would clobber any
   * `previewTrackMap` field, and vice versa. Failures surface via
   * `saveError` so the user notices the miss without blocking the
   * editor.
   */
  const updateSidecar = useCallback(
    async (partial: { sourceFolder?: string | null; previewTrackMap?: string | null }) => {
      try {
        const existing = await readSongSidecar(songFolder);
        await writeSongSidecar(songFolder, { ...existing, ...partial });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSaveError(`Sidecar didn't persist: ${msg}`);
      }
    },
    [songFolder],
  );

  /**
   * Update the per-song source folder — both in local state (for the
   * source pane) and in the on-disk sidecar (so it persists). Uses
   * the merge helper so a sourceFolder write doesn't clobber
   * previewTrackMap (or any other future field).
   */
  const handleChangeSourceFolder = useCallback(
    (path: string | null) => {
      setSourceFolder(path);
      void updateSidecar({ sourceFolder: path });
    },
    [updateSidecar],
  );

  /**
   * "Import all" button on the Source Folder tab.
   *
   * Walks the source folder, splits files into two buckets:
   *
   *   1. Smart-matched assignments. For each `.wav`, we compare the
   *      file's stem (filename without extension, lowercased) against
   *      the lowercased trackmap channel labels. A hit lands the file
   *      on that channel — but only if the channel is currently empty
   *      (existing assignments are never overwritten). The change
   *      goes through `applyEdit` so it's undoable + dirties the
   *      editor (Save required to commit). The matched WAV's actual
   *      bytes get queued in `pendingCopies` and copy in on Save,
   *      mirroring the single-file click flow.
   *
   *   2. Unmatched / overflow files. WAVs whose stem doesn't match
   *      any labeled channel, OR whose matching channel is occupied,
   *      get copied directly into the song folder via
   *      `copyIntoFolder` — no channel assignment. They show up in
   *      the Song Folder tab immediately so the user can find them
   *      and click-assign manually later. Same for any MIDI beyond
   *      the first when the MIDI slot is already filled.
   *
   * The first MIDI file is the lone MIDI exception — it lands on the
   * MIDI slot if that slot is empty (BandMate only has one MIDI
   * channel). Subsequent MIDIs fall into the direct-copy bucket.
   *
   * Stereo WAVs and WAVs with hard-error diagnostics are skipped
   * entirely — same filter the single-file path uses (the BandMate
   * won't play them).
   */
  /**
   * Apply a fully-bucketed import. Performs three things in order:
   *
   *   1. `applyEdit` — record channel-assignment changes onto the
   *      undo stack and flip the dirty flag. Empty-channel auto-
   *      assigns + approved replacements both flow through here so
   *      the per-row change-dot indicator highlights them uniformly.
   *   2. Eager-copy every file (assigned + unassigned) into the
   *      song folder so the Song Folder pane reflects the import
   *      without waiting on Save.
   *   3. Toast — count files actually copied; surface failures.
   *
   * `pending` carries the bucket decisions made by `handleImportAll`.
   * `acceptedReplacements` controls which proposed replacements
   * actually fire — pass an empty Set to skip them all (used by the
   * "Import without auto-mapping" path, which ALSO suppresses
   * `pending.newAudioByChannel` / `pending.newMidi` via `applyEmpty`).
   *
   * Idempotent w.r.t. song-folder copies: files already on disk get
   * overwritten by the OS-level copy, matching the single-file path.
   */
  const commitImport = useCallback(
    async (
      pending: PendingImport,
      acceptedReplacements: Set<number>,
      applyEmpty: boolean,
    ) => {
      // Resolve which audio assignments to write: empty-channel
      // winners (gated by applyEmpty) + accepted replacements.
      const audioAssignments = new Map<number, AudioFileInfo>();
      if (applyEmpty) {
        for (const [ch, file] of pending.newAudioByChannel) {
          audioAssignments.set(ch, file);
        }
      }
      for (const ch of acceptedReplacements) {
        if (ch === MIDI_CHANNEL_INDEX) continue;
        const f = pending.replacementFileByChannel.get(ch);
        if (f) audioAssignments.set(ch, f);
      }

      // MIDI assignment: either the empty-slot winner (if applyEmpty)
      // or an accepted MIDI replacement. Mutually exclusive — the
      // empty path only fires when the slot is unoccupied; the
      // replacement path only fires when it IS occupied.
      let midiAssignment: AudioFileInfo | null = null;
      let isMidiReplacement = false;
      if (
        applyEmpty &&
        pending.newMidi &&
        !editor.current?.song.midiFile
      ) {
        midiAssignment = pending.newMidi;
      } else if (acceptedReplacements.has(MIDI_CHANNEL_INDEX)) {
        const f = pending.replacementFileByChannel.get(MIDI_CHANNEL_INDEX);
        if (f) {
          midiAssignment = f;
          isMidiReplacement = true;
        }
      }

      if (audioAssignments.size > 0 || midiAssignment) {
        applyEdit((snap) => {
          // For replacements, drop the existing channel entry before
          // adding the new one — otherwise we'd end up with two
          // SongAudioFile entries claiming the same channel.
          const replacingChannels = new Set<number>();
          for (const ch of acceptedReplacements) {
            if (ch !== MIDI_CHANNEL_INDEX) replacingChannels.add(ch);
          }
          const filteredAudio = snap.song.audioFiles.filter(
            (a) => !replacingChannels.has(a.channel),
          );
          const nextAudio = [...filteredAudio];
          for (const [ch, file] of audioAssignments) {
            // For empty-channel auto-assigns, mirror the manual
            // assign defaults (1.0 / 0.5 / unmuted). For replacements,
            // preserve the prior channel's level/pan/mute so users
            // don't lose hand-tuned mixer settings when swapping a
            // file. This matches what most DAW workflows expect.
            const prior = snap.song.audioFiles.find((a) => a.channel === ch);
            nextAudio.push({
              filename: file.filename,
              channel: ch,
              level: prior?.level ?? 1.0,
              pan: prior?.pan ?? 0.5,
              mute: prior?.mute ?? 1.0,
            });
          }

          let nextMidi = snap.song.midiFile;
          if (midiAssignment) {
            // Replace OR fill — either way a fresh object lands.
            nextMidi = {
              filename: midiAssignment.filename,
              channel: MIDI_CHANNEL_INDEX,
            };
          }

          // Replacements also invalidate any pending-copy entry that
          // would re-introduce the OLD assignment at Save. (Possible
          // if the user click-assigned a file and then ran Import all
          // before saving.) Drop those entries to keep state coherent.
          let nextPending = snap.pendingCopies;
          if (replacingChannels.size > 0 || isMidiReplacement) {
            nextPending = new Map(snap.pendingCopies);
            for (const ch of replacingChannels) nextPending.delete(ch);
            if (isMidiReplacement) nextPending.delete(MIDI_CHANNEL_INDEX);
          }

          return {
            song: {
              ...snap.song,
              audioFiles: nextAudio.sort((a, b) => a.channel - b.channel),
              midiFile: nextMidi,
            },
            pendingCopies: nextPending,
          };
        });
      }

      // Eager-copy EVERY file the import surfaced. Unaccepted
      // replacements still copy in — they just stay unassigned. Same
      // friendliness as today's direct-copy bucket for unmatched
      // files: the file lands in the song folder, ready for click-
      // assign if the user changes their mind.
      const allFilesToCopy: AudioFileInfo[] = [
        ...pending.newAudioByChannel.values(),
        ...(pending.newMidi ? [pending.newMidi] : []),
        ...pending.replacementFileByChannel.values(),
        ...pending.directCopy,
      ];
      const failedCopies: string[] = [];
      if (allFilesToCopy.length > 0) {
        await Promise.all(
          allFilesToCopy.map(async (file) => {
            try {
              await copyIntoFolder(file.path, songFolder);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error(
                `Import-all: failed to copy ${file.filename}:`,
                e,
              );
              failedCopies.push(file.filename);
            }
          }),
        );
        setSongFolderRefreshKey((k) => k + 1);
      }

      const totalAttempted = allFilesToCopy.length;
      if (totalAttempted > 0) {
        const successCount = totalAttempted - failedCopies.length;
        let msg = `Imported ${successCount} file${successCount === 1 ? "" : "s"} into the song folder.`;
        if (failedCopies.length > 0) {
          msg += ` ${failedCopies.length} failed to copy (see console).`;
        }
        setToastMessage(msg);
      } else if (pending.alreadyInSongCount > 0) {
        setToastMessage(
          `All ${pending.alreadyInSongCount} source file${
            pending.alreadyInSongCount === 1 ? " is" : "s are"
          } already in the song folder.`,
        );
      }
    },
    [applyEdit, songFolder, editor],
  );

  const handleImportAll = useCallback(async () => {
    if (!sourceFolder || !draftSong || !editor.current) return;

    let sourceFiles: AudioFileInfo[];
    try {
      sourceFiles = await listAudioFiles(sourceFolder);
    } catch (e) {
      void message(
        `Couldn't read source folder: ${e instanceof Error ? e.message : String(e)}`,
        { title: "Import all", kind: "error" },
      );
      return;
    }

    // Mirror the single-file path's filter: stereo and hard-error
    // WAVs aren't usable on the BandMate, so skip silently. Sample-
    // rate mismatches are NOT filtered — they're allowed (the row
    // shows a rate-mismatch warning, same as today).
    const usable = sourceFiles.filter((f) => {
      if (f.kind === "wav") {
        const isStereo = (f.wavInfo?.channels ?? 1) > 1;
        const isHardError = f.diagnostic?.severity === "error";
        return !isStereo && !isHardError;
      }
      return true;
    });
    if (usable.length === 0) return;

    // Detect "already in song folder" by name. Best-effort listing
    // — if the song folder can't be read for any reason we proceed
    // without dedup (better to over-copy than to skip silently).
    // Case-insensitive compare matches APFS default semantics.
    let songFolderListing: AudioFileInfo[] = [];
    try {
      songFolderListing = await listAudioFiles(songFolder);
    } catch {
      songFolderListing = [];
    }
    const existingInSong = new Set(
      songFolderListing.map((f) => f.filename.toLowerCase()),
    );

    // Split usable into "already there" vs "new". Files already in
    // the song folder are skipped entirely from import-all — the
    // user can manually re-import a single file if they want to
    // overwrite (by clearing the song-folder copy first).
    const alreadyInSong: AudioFileInfo[] = [];
    const newImports: AudioFileInfo[] = [];
    for (const f of usable) {
      if (existingInSong.has(f.filename.toLowerCase())) {
        alreadyInSong.push(f);
      } else {
        newImports.push(f);
      }
    }

    // ---- Bucket assignment ---------------------------------------------
    //
    // Smart Mapping on (default): fuzzy-match, mtime-tiebreak, split
    // into three buckets — empty-channel winners (auto-apply), occupied-
    // channel proposals (route through `SmartImportConfirmDialog`),
    // and direct-copy leftovers (copy unassigned).
    //
    // Smart Mapping off: skip the matcher entirely. Every file copies
    // into the song folder unassigned. No dialog, no auto-assigns.
    const newAudioByChannel = new Map<number, AudioFileInfo>();
    const replacementFileByChannel = new Map<number, AudioFileInfo>();
    const replacementsForDialog: ProposedReplacement[] = [];
    let newMidi: AudioFileInfo | null = null;
    let directCopy: AudioFileInfo[];

    if (state.userPrefs.smartMappingEnabled) {
      const skipMidi = new Set([MIDI_CHANNEL_INDEX]);
      type Claim = { file: AudioFileInfo; score: number };
      const claimsByChannel = new Map<number, Claim[]>();
      const wavUnmatched: AudioFileInfo[] = [];

      for (const file of newImports) {
        if (file.kind !== "wav") continue;
        const match = bestChannelForFilename(file.filename, labels, skipMidi);
        if (!match) {
          wavUnmatched.push(file);
          continue;
        }
        const existing = claimsByChannel.get(match.channel) ?? [];
        existing.push({ file, score: match.score });
        claimsByChannel.set(match.channel, existing);
      }

      // Per-channel winner + mtime tiebreak. Losers fall to
      // direct-copy regardless of whether the channel was empty
      // or occupied — at-most-one proposal per channel.
      const winnerByChannel = new Map<number, AudioFileInfo>();
      for (const [ch, claims] of claimsByChannel.entries()) {
        if (claims.length === 1) {
          winnerByChannel.set(ch, claims[0].file);
          continue;
        }
        const sorted = [...claims].sort(
          (a, b) =>
            (b.file.modifiedSeconds ?? -Infinity) -
            (a.file.modifiedSeconds ?? -Infinity),
        );
        winnerByChannel.set(ch, sorted[0].file);
        for (let i = 1; i < sorted.length; i++) {
          wavUnmatched.push(sorted[i].file);
        }
      }

      // Partition winners into "empty channel" (auto-assign) vs
      // "occupied channel, file differs" (propose replacement) vs
      // "occupied channel, same file" (no-op, file already there).
      const existingByCh = new Map<number, string>(
        editor.current.song.audioFiles.map((a) => [a.channel, a.filename]),
      );
      for (const [ch, file] of winnerByChannel.entries()) {
        const currentFilename = existingByCh.get(ch);
        if (currentFilename === undefined) {
          newAudioByChannel.set(ch, file);
          continue;
        }
        if (currentFilename === file.filename) {
          // Same file on the same channel — no-op for the dialog.
          // The file's already in the song folder (would have been
          // filtered by `alreadyInSong` above) so nothing to do.
          // Defensive: still ensure the file is in the copy bucket.
          continue;
        }
        replacementFileByChannel.set(ch, file);
        replacementsForDialog.push({
          channelIndex: ch,
          channelLabel: labels[ch] ?? "",
          currentFilename,
          proposedFilename: file.filename,
        });
      }

      // MIDI: same three-way partition. If slot is empty → auto-fill
      // newest MIDI. If occupied AND the newest MIDI differs from the
      // current assignment → propose replacement. Other MIDI files
      // (overflow) fall to direct-copy.
      const midiFiles = newImports.filter((f) => f.kind === "mid");
      let midiWinnerCandidate: AudioFileInfo | null = null;
      if (midiFiles.length > 0) {
        midiWinnerCandidate = [...midiFiles].sort(
          (a, b) =>
            (b.modifiedSeconds ?? -Infinity) -
            (a.modifiedSeconds ?? -Infinity),
        )[0];
      }
      const midiSlotCurrent = editor.current.song.midiFile?.filename;
      if (midiWinnerCandidate) {
        if (!midiSlotCurrent) {
          newMidi = midiWinnerCandidate;
        } else if (midiSlotCurrent !== midiWinnerCandidate.filename) {
          replacementFileByChannel.set(
            MIDI_CHANNEL_INDEX,
            midiWinnerCandidate,
          );
          replacementsForDialog.push({
            channelIndex: MIDI_CHANNEL_INDEX,
            channelLabel: "MIDI",
            currentFilename: midiSlotCurrent,
            proposedFilename: midiWinnerCandidate.filename,
          });
        }
        // If same filename: no-op (already in song folder).
      }
      const midiOverflow = midiFiles.filter(
        (f) => f !== midiWinnerCandidate,
      );

      directCopy = [...wavUnmatched, ...midiOverflow];
    } else {
      directCopy = [...newImports];
    }

    // Sort replacements by channel index so the dialog renders in
    // grid order — matches the editor's mental model and makes the
    // user's review path predictable.
    replacementsForDialog.sort((a, b) => a.channelIndex - b.channelIndex);

    const pending: PendingImport = {
      newAudioByChannel,
      newMidi,
      replacements: replacementsForDialog,
      replacementFileByChannel,
      directCopy,
      alreadyInSongCount: alreadyInSong.length,
    };

    if (replacementsForDialog.length === 0) {
      // No-replacement fast path — preserves the friction-free behavior
      // for first imports of a song (the common case). No dialog, just
      // apply + copy + toast.
      await commitImport(pending, new Set(), /* applyEmpty */ true);
      return;
    }

    // At least one replacement — surface the dialog. `commitImport`
    // fires from the dialog's onConfirm / onImportWithoutAutoMapping
    // handlers below.
    setPendingImport(pending);
  }, [
    sourceFolder,
    songFolder,
    draftSong,
    commitImport,
    labels,
    editor,
    state.userPrefs.smartMappingEnabled,
  ]);

  /**
   * Dialog callback: user clicked Confirm. Apply the accepted
   * replacements alongside any pre-computed empty-channel winners.
   * Unchecked replacements still copy their files in (unassigned)
   * via the eager-copy step.
   */
  const handleConfirmSmartImport = useCallback(
    async (acceptedChannels: Set<number>) => {
      if (!pendingImport) return;
      const snapshot = pendingImport;
      setPendingImport(null);
      await commitImport(snapshot, acceptedChannels, /* applyEmpty */ true);
    },
    [pendingImport, commitImport],
  );

  /**
   * Dialog callback: user clicked "Import without auto-mapping" — a
   * one-time opt-out. Applies no channel assignments (not even the
   * empty-channel winners). All candidate files still copy into the
   * song folder so the user can click-assign manually.
   */
  const handleImportWithoutAutoMapping = useCallback(async () => {
    if (!pendingImport) return;
    const snapshot = pendingImport;
    setPendingImport(null);
    await commitImport(snapshot, new Set(), /* applyEmpty */ false);
  }, [pendingImport, commitImport]);

  /**
   * Dialog callback: user clicked Cancel / hit Esc / clicked
   * backdrop. Abort the import entirely — no copies, no assigns. The
   * source files remain in the source folder, ready for another
   * Import all run.
   */
  const handleCancelSmartImport = useCallback(() => {
    setPendingImport(null);
  }, []);

  /**
   * "Clean up…" button on the Song Folder tab. Re-fetches the folder
   * listing fresh (rather than trusting cached `folderFiles`) so the
   * confirm dialog is built against on-disk truth at the moment the
   * user clicked. The dialog itself handles the empty case
   * gracefully — we always open it on click, never silently no-op.
   */
  const handleOpenCleanup = useCallback(async () => {
    if (!draftSong) return;
    try {
      const files = await listAudioFiles(songFolder);
      const { unreferenced } = classifySongFolderFiles(draftSong, files);
      setCleanupCandidates(unreferenced);
    } catch (e) {
      // Open the dialog with an empty list so the user gets a clear
      // "nothing to clean up" state; surface the underlying error
      // via console for diagnosis.
      // eslint-disable-next-line no-console
      console.error("listAudioFiles failed before cleanup:", e);
      setCleanupCandidates([]);
    }
  }, [draftSong, songFolder]);

  /**
   * Confirm handler — actually deletes the files, then refreshes the
   * Song Folder tab so the list reflects the post-delete state.
   * Errors propagate to the dialog (it surfaces them inline and
   * stays open so the user can retry).
   */
  const handleConfirmCleanup = useCallback(
    async (filenames: string[]) => {
      if (!state.workingFolder) {
        throw new Error("No working folder selected.");
      }
      await deleteFilesInSongFolder(
        state.workingFolder,
        songFolder,
        filenames,
      );
      // Bump the Song Folder tab so it re-lists. Same mechanism the
      // post-save / manual-MIDI-clean paths already use.
      setSongFolderRefreshKey((k) => k + 1);
    },
    [songFolder, state.workingFolder],
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

  // Register dirty state so the unsaved-changes guard can intercept
  // sidebar clicks / ESC. We use a ref to read the latest isDirty
  // value without retriggering the registration on every change.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    return registerDirtyEditor({
      isDirty: () => isDirtyRef.current,
      label: songName,
    });
  }, [registerDirtyEditor, songName]);

  const canUndo = editor.past.length > 0;
  const canRedo = editor.future.length > 0;

  // ---- Save --------------------------------------------------------------
  // Capture latest state in a ref so the keydown listener reads fresh values
  // without re-binding the listener on every keystroke. cleanMidiOnImport
  // is read from userPrefs at save time — toggling the Settings switch
  // mid-edit takes effect on the next save without re-binding.
  const cleanMidiOnImport = state.userPrefs.cleanMidiOnImport;
  const saveStateRef = useRef({
    snapshot: editor.current,
    songFolder,
    isDirty,
    saving,
    jcsPath,
    songName,
    cleanMidiOnImport,
  });
  saveStateRef.current = {
    snapshot: editor.current,
    songFolder,
    isDirty,
    saving,
    jcsPath,
    songName,
    cleanMidiOnImport,
  };

  /** Open the save dialog. The dialog drives the actual save / save-as. */
  const handleSave = useCallback(() => {
    const s = saveStateRef.current;
    if (!s.snapshot || s.saving || !s.isDirty) return;
    setSaveDialogOpen(true);
  }, []);

  /**
   * Persist the current snapshot to its existing on-disk path (the
   * "Save" branch of the confirm dialog). Copies any pending files,
   * recomputes lengthSamples, writes the .jcs, then updates baseline.
   */
  const performSave = useCallback(async () => {
    const s = saveStateRef.current;
    if (!s.snapshot) return;
    setSaving(true);
    setSaveError(null);
    try {
      for (const { sourcePath } of s.snapshot.pendingCopies.values()) {
        const destPath = await copyIntoFolder(sourcePath, s.songFolder);
        await maybeAutoCleanMidi(destPath, s.cleanMidiOnImport);
      }
      const list = await listAudioFiles(s.songFolder);
      const assignedWavs = new Set(
        s.snapshot.song.audioFiles.map((f) => f.filename),
      );
      const assignedMidi = s.snapshot.song.midiFile?.filename ?? null;
      // <length> = max(durations of ASSIGNED media). Both WAV and MIDI
      // count — BM Loader includes MIDI duration in this calculation
      // (smoke-test finding F-2). The MIDI duration is needed so the
      // BandMate plays long enough for any trailing program changes
      // at the end of the MIDI to fire before auto-advancing.
      const songRate = s.snapshot.song.sampleRate;
      let maxSamples = 0;
      let newLongest: string | null = null;
      for (const f of list) {
        const isAssignedWav =
          f.kind === "wav" && assignedWavs.has(f.filename);
        const isAssignedMidi =
          f.kind === "mid" && assignedMidi === f.filename;
        if (!isAssignedWav && !isAssignedMidi) continue;
        // Convert seconds → samples at the song's rate so the value
        // we write into <length> is in the same units as BM Loader's.
        const seconds = f.durationSeconds ?? 0;
        const samples = Math.round(seconds * songRate);
        if (samples > maxSamples) {
          maxSamples = samples;
          newLongest = f.filename;
        }
      }
      const finalSong: Song = {
        ...s.snapshot.song,
        lengthSamples: maxSamples,
      };
      const text = writeSong(finalSong);
      await writeTextFile(s.jcsPath, text);
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
      // Bump so SourceFilesPane's Song Folder tab re-lists — files
      // may have been copied in and / or auto-cleaned in place.
      setSongFolderRefreshKey((k) => k + 1);
      await rescan();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [rescan]);

  /**
   * Save the current snapshot to a brand-new song folder under
   * `newName`, leaving the original untouched. After success we
   * navigate to the duplicate so the user keeps editing the new
   * copy (matches macOS Save-As convention).
   *
   * Steps:
   *   1. duplicateSong(currentName, newName) — Rust copies the whole
   *      folder + renames the inner .jcs.
   *   2. Copy any pendingCopies into the new folder (these are files
   *      not yet on disk; the duplicate didn't have them).
   *   3. Re-probe + recompute lengthSamples in the new folder.
   *   4. Write the in-memory .jcs to the new path (overwrites the
   *      copy from step 1, which had pre-edit content).
   *   5. Carry over the source-folder sidecar (if any).
   *   6. Rescan + dispatch select.
   */
  const performSaveAs = useCallback(
    async (newName: string) => {
      const s = saveStateRef.current;
      if (!s.snapshot || !state.workingFolder) return;
      setSaving(true);
      setSaveError(null);
      try {
        const created = await duplicateSong(
          state.workingFolder,
          songName,
          newName,
        );
        // Step 2: pendingCopies into the new folder.
        for (const { sourcePath } of s.snapshot.pendingCopies.values()) {
          const destPath = await copyIntoFolder(sourcePath, created.folderPath);
          await maybeAutoCleanMidi(destPath, s.cleanMidiOnImport);
        }
        // Step 3: probe + recompute longest. Includes MIDI (see
        // performSave for the rationale — finding F-2).
        const list = await listAudioFiles(created.folderPath);
        const assignedWavs = new Set(
          s.snapshot.song.audioFiles.map((f) => f.filename),
        );
        const assignedMidi = s.snapshot.song.midiFile?.filename ?? null;
        const songRate = s.snapshot.song.sampleRate;
        let maxSamples = 0;
        for (const f of list) {
          const isAssignedWav =
            f.kind === "wav" && assignedWavs.has(f.filename);
          const isAssignedMidi =
            f.kind === "mid" && assignedMidi === f.filename;
          if (!isAssignedWav && !isAssignedMidi) continue;
          const samples = Math.round((f.durationSeconds ?? 0) * songRate);
          if (samples > maxSamples) maxSamples = samples;
        }
        const finalSong: Song = {
          ...s.snapshot.song,
          lengthSamples: maxSamples,
        };
        // Step 4: write the .jcs with current edits.
        await writeTextFile(created.jcsPath, writeSong(finalSong));
        // Step 5: carry over sidecar fields (source folder + preview
        // trackmap). The duplicate-folder copy already includes the
        // original's sidecar, but we write fresh so any in-memory
        // changes (e.g. trackmap switched mid-edit) propagate, and
        // so the field set is consistent.
        const previewTrackMap =
          trackMapSource?.split("/").pop() ?? null;
        if (sourceFolder || previewTrackMap) {
          await writeSongSidecar(created.folderPath, {
            sourceFolder: sourceFolder ?? undefined,
            previewTrackMap: previewTrackMap ?? undefined,
          });
        }
        // Step 6: rescan + jump to the new copy. SongEditor remounts
        // on jcsPath change (via key), so the new editor instance
        // starts fresh with baseline = current — non-dirty.
        await rescan();
        dispatch({
          type: "select",
          selection: { kind: "song", jcsPath: created.jcsPath },
        });
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [dispatch, rescan, songName, sourceFolder, trackMapSource, state.workingFolder],
  );

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
      // ⌥⌘Z (Alt+Cmd+Z, no shift) — toggle Undo History panel
      //
      // Use e.code (physical key) rather than e.key (character)
      // because macOS rewrites e.key when Option is held — ⌥Z
      // becomes "Ω", so `key === "z"` would never match the history
      // shortcut.
      if (meta && e.code === "KeyZ") {
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
      if (meta && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      // Cmd/Ctrl + Arrow — swap the highlighted channel with the
      // adjacent one. Audio only (MIDI's slot is fixed at index 24).
      // Skipped when focus is in an input so it doesn't fight text
      // caret moves inside, e.g., the New Song dialog.
      if (meta && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
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
        const sel = state.channelSelection;
        if (sel === null || sel === MIDI_CHANNEL_INDEX) return;
        e.preventDefault();
        const delta = e.key === "ArrowUp" ? -1 : 1;
        handleSwapChannels(sel, sel + delta);
        return;
      }
      // Plain Arrow Up/Down (no modifier) — move the row selection
      // up/down through the channel grid. Only fires when a row is
      // already selected; pressing arrows with no selection is a
      // no-op (avoids surprise selection-from-nothing on stray
      // keypresses). Stops at the boundaries — no wraparound.
      // The MIDI slot at index 24 is included in the navigation
      // since it renders as the last row in the grid.
      if (
        !meta &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
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
        const sel = state.channelSelection;
        if (sel === null) return;
        const delta = e.key === "ArrowUp" ? -1 : 1;
        const next = sel + delta;
        if (next < 0 || next > MIDI_CHANNEL_INDEX) return;
        e.preventDefault();
        dispatch({ type: "select_channel", channel: next });
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
  }, [
    handleSave,
    handleClearChannel,
    handleSwapChannels,
    undo,
    redo,
    state.channelSelection,
    dispatch,
  ]);

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
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <ChannelGrid
          song={draftSong}
          channelLabels={labels}
          channelChanges={channelChanges}
          longestFilename={longestFilename}
          longestDurationSeconds={
            draftSong.lengthSamples / draftSong.sampleRate
          }
          channelSampleRates={channelSampleRates}
          channelMeta={channelMeta}
          midiClean={(() => {
            const f = draftSong.midiFile?.filename;
            if (!f) return null;
            const info = folderFiles.find((x) => x.filename === f);
            return info?.isMidiClean ?? null;
          })()}
          onCleanMidi={async () => {
            const f = draftSong.midiFile?.filename;
            if (!f) return;
            const info = folderFiles.find((x) => x.filename === f);
            if (!info) return;
            // Confirm before modifying user files. The badge click is
            // the only path through here — the Settings retroactive
            // sweep calls cleanMidiFile() directly, with its own
            // dedicated confirm.
            const proceed = await ask(
              `This will clean "${f}" inside the song folder, removing meta events ` +
                `(markers, key signatures, etc.) that may cause spurious patch changes ` +
                `on a live MIDI port.\n\n` +
                `The original file in your source folder is not modified.\n\n` +
                `Clean now?`,
              {
                title: "Clean MIDI file?",
                kind: "info",
                okLabel: "Clean",
                cancelLabel: "Cancel",
              },
            );
            if (!proceed) return;
            try {
              await cleanMidiFile(info.path);
              // Re-list to refresh the channel-grid badge…
              const list = await listAudioFiles(songFolder);
              setFolderFiles(list);
              // …and bump the SourceFilesPane's Song Folder tab so its
              // cleanliness pill flips alongside.
              setSongFolderRefreshKey((k) => k + 1);
            } catch (err) {
              console.error("Manual clean failed:", err);
            }
          }}
          selectedChannel={state.channelSelection}
          onSelectChannel={handleSelectChannel}
          onDropFile={(file, channel, mode) =>
            handleSelectSourceFile(file, channel, mode)
          }
          onMoveChannel={handleMoveChannel}
          onSwapChannel={handleSwapChannels}
          onClearChannel={handleClearChannel}
        />
        <SourceFilesPane
          songFolder={songFolder}
          sourceFolder={sourceFolder}
          songSampleRate={draftSong.sampleRate}
          channelSelected={state.channelSelection !== null}
          songFolderRefreshKey={songFolderRefreshKey}
          onSelectFile={handleSelectSourceFile}
          onChangeSourceFolder={(path) => handleChangeSourceFolder(path)}
          onClearSourceFolder={() => handleChangeSourceFolder(null)}
          onCleanupUnreferenced={() => void handleOpenCleanup()}
          onImportAll={() => void handleImportAll()}
        />
      </div>

      <UndoHistoryPanel
        isOpen={historyOpen}
        pastCount={editor.past.length}
        futureCount={editor.future.length}
        baselineIndex={(() => {
          // Baseline as an index into the flat list. Compare via the
          // serialized snapshot — the baseline reference is one of
          // the entries in the flat list (post-save = the one at
          // pastCount; pre-save edits = the original at index 0).
          if (!editor.baseline || !editor.current) return null;
          const flat = [
            ...editor.past,
            editor.current,
            ...editor.future,
          ];
          const baselineKey = writeSong(editor.baseline.song);
          for (let i = 0; i < flat.length; i++) {
            if (writeSong(flat[i]!.song) === baselineKey) return i;
          }
          return null;
        })()}
        entryLabels={(() => {
          if (!editor.current) return undefined;
          const flat = [
            ...editor.past,
            editor.current,
            ...editor.future,
          ];
          return flat.map((snap, i) =>
            i === 0
              ? "Initial state"
              : diffSongs(flat[i - 1]!.song, snap.song),
          );
        })()}
        onJumpTo={(idx) => {
          jumpToHistoryIndex(idx);
        }}
        onClose={() => setHistoryOpen(false)}
      />

      <SaveConfirmDialog
        isOpen={saveDialogOpen}
        title="Save Song"
        subjectName={songName}
        message={
          <>
            Overwrites the existing <span className="font-mono">.jcs</span>
            {editor.current && editor.current.pendingCopies.size > 0 ? (
              <>
                {" and copies "}
                {editor.current.pendingCopies.size} new file
                {editor.current.pendingCopies.size === 1 ? "" : "s"} into
                the song folder.
              </>
            ) : (
              "."
            )}
          </>
        }
        existingNames={
          new Set(state.scan.songs.map((s) => s.folderName))
        }
        defaultNewName={suggestDuplicateName(
          songName,
          new Set(state.scan.songs.map((s) => s.folderName)),
        )}
        itemKind="song"
        onSave={performSave}
        onSaveAs={performSaveAs}
        onClose={() => setSaveDialogOpen(false)}
      />

      <CleanupConfirmDialog
        isOpen={cleanupCandidates !== null}
        songName={songName}
        files={cleanupCandidates ?? []}
        onConfirm={handleConfirmCleanup}
        onClose={() => setCleanupCandidates(null)}
      />

      <SmartImportConfirmDialog
        isOpen={pendingImport !== null}
        songName={songName}
        replacements={pendingImport?.replacements ?? []}
        onConfirm={(accepted) => void handleConfirmSmartImport(accepted)}
        onImportWithoutAutoMapping={() => void handleImportWithoutAutoMapping()}
        onCancel={handleCancelSmartImport}
      />

      {toastMessage && (
        <Toast
          message={toastMessage}
          onDismiss={() => setToastMessage(null)}
        />
      )}
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
