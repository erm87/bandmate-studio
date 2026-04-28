/**
 * The 25-row channel grid in the Song editor.
 *
 * Columns: # | Label | (icon slot) | File | Lvl | Pan | (delete slot)
 *
 * Phase 3d additions:
 *   - Rows are now buttons. Clicking selects the channel (highlight),
 *     clicking the same row again toggles it off.
 *   - The selected row gets the brand color highlight.
 *   - Channel selection is owned by AppState (via the `selectedChannel`
 *     prop) so the global ESC handler can clear it before falling
 *     back to clearing the sidebar selection.
 *   - SourceFilesPane consults this selection to know which channel a
 *     clicked source file should land on.
 *
 * Density notes:
 *   - Each row is ~28px tall (py-1 around text-xs). 25 rows = ~700px.
 *   - Lvl/Pan columns are deliberately narrow (40px) — secondary info.
 *   - Lvl/Pan formatted with one decimal ("1.0", "0.5") matching the
 *     .jcs file's stored precision.
 */

import { useEffect, useState } from "react";
import { MIDI_CHANNEL_INDEX, TRACK_MAP_CHANNEL_COUNT, type Song } from "../codec";
import type { AudioFileInfo } from "../fs/types";
import { cn } from "../lib/cn";
import {
  readDragPayload,
  setDragImageLabel,
  setDragPayload,
} from "../lib/dnd";

interface Props {
  song: Song;
  /** Channel labels from the active track map (length 25). */
  channelLabels: string[];
  /**
   * Filename of the audio file with the largest duration. The BandMate
   * plays each song until the longest WAV ends, so we surface it.
   */
  longestFilename: string | null;
  /** Duration in seconds of the longest file (= the song's duration). */
  longestDurationSeconds: number;
  /**
   * Per-channel actual WAV sample rate, derived from the song folder's
   * file probe (or the pending-copy queue for files queued but not yet
   * copied in). Channels with no entry have an unknown rate. Used to
   * flag mismatches against the song's selected sample rate.
   */
  channelSampleRates: Map<number, number>;
  /**
   * Per-channel full WAV metadata (sample rate + channel count + duration).
   * Used for the row's hover tooltip + the drag-image label so the
   * user can see the track spec at a glance.
   */
  channelMeta: Map<number, ChannelMeta>;
  /** Currently-selected channel index, or null if none. */
  selectedChannel: number | null;
  /** Toggle selection of a channel. Pass `null` to clear. */
  onSelectChannel: (channel: number | null) => void;
  /**
   * Called when a source file is dropped onto a channel. The validation
   * (stereo / rate / kind / MIDI-slot match) happens in the parent so
   * an unhappy drop is a silent no-op (matches the click-to-assign
   * behavior — clicking a stereo file from the source pane also no-ops).
   *
   * `mode` controls what happens to any existing assignment at the
   * target: replace = overwrite; shiftUp = existing moves to channel-1;
   * shiftDown = existing moves to channel+1. The parent gracefully
   * falls back to replace if the shift target is occupied or out of
   * bounds.
   */
  onDropFile: (
    file: AudioFileInfo,
    channel: number,
    mode: DropMode,
  ) => void;
  /**
   * Called when an existing channel assignment is dragged to another
   * channel. Same `mode` semantics as `onDropFile`. For empty target
   * channels, mode is always "replace" (which is just a move).
   */
  onMoveChannel: (from: number, to: number, mode: DropMode) => void;
  /**
   * Swap the assignments at two adjacent channels. Used by the on-row
   * ↑ / ↓ buttons that appear when a channel is selected. Symmetric
   * (no cascade); both files keep their level / pan / mute.
   */
  onSwapChannel: (a: number, b: number) => void;
  /**
   * Clear the assignment at the selected channel. Used by the on-row
   * × button. Same handler as the Delete/Backspace shortcut.
   */
  onClearChannel: () => void;
}

/**
 * How a drop on an *occupied* channel should treat the existing file.
 *
 *   - `replace`:   overwrite — existing file is discarded
 *   - `shiftUp`:   existing file moves to `channel - 1`
 *   - `shiftDown`: existing file moves to `channel + 1`
 *
 * Empty targets always use `replace` (which is just an add/move).
 */
export type DropMode = "replace" | "shiftUp" | "shiftDown";

/** Y-position thresholds (in px) for the three drop zones on an
 *  occupied row. Outside these strips, the zone is "replace". */
const SHIFT_EDGE_PX = 8;

/**
 * WAV-derived per-channel metadata used for tooltips + drag preview.
 *
 *   - sampleRate: Hz
 *   - channels: 1 (mono), 2 (stereo) — stereo is rejected at assign time
 *     but we surface the value here in case it slipped past
 *   - durationSeconds: track length in seconds
 */
export interface ChannelMeta {
  sampleRate: number;
  channels: number;
  durationSeconds: number;
}

/**
 * Format a `ChannelMeta` as a one-line spec string, e.g.
 * "44.1 kHz · mono · 3:21". Returns empty string if no meta —
 * caller substitutes a fallback like just the filename.
 */
function formatMetaLine(meta: ChannelMeta | undefined): string {
  if (!meta) return "";
  const seconds = Math.max(0, Math.floor(meta.durationSeconds));
  const mm = Math.floor(seconds / 60);
  const ss = (seconds % 60).toString().padStart(2, "0");
  const chLabel = meta.channels === 1 ? "mono" : `${meta.channels}ch`;
  return `${(meta.sampleRate / 1000).toFixed(1)} kHz · ${chLabel} · ${mm}:${ss}`;
}

// Column template:
//   Ch # | Label | (icon slot) | File | Lvl | Pan | (action slot)
//
// The 16px icon slot between Label and File is always rendered, even
// for rows without the longest indicator, so filenames in the File
// column are left-aligned at the same x-position regardless.
//
// The trailing 72px slot holds the on-row ↑ / ↓ / × buttons that
// appear when the row is selected. It's reserved at all times so
// rows don't reflow when selection moves.
const COLS = "grid-cols-[32px_110px_16px_1fr_40px_40px_72px]";

/** Format a duration in seconds as `m:ss` (zero-padded seconds). */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(seconds / 60);
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function ChannelGrid({
  song,
  channelLabels,
  longestFilename,
  longestDurationSeconds,
  channelSampleRates,
  channelMeta,
  selectedChannel,
  onSelectChannel,
  onDropFile,
  onMoveChannel,
  onSwapChannel,
  onClearChannel,
}: Props) {
  const longestDurationLabel = formatDuration(longestDurationSeconds);
  const audioByChannel = new Map<number, Song["audioFiles"][number]>();
  for (const f of song.audioFiles) {
    audioByChannel.set(f.channel, f);
  }
  const midi = song.midiFile;
  const songRate = song.sampleRate;

  const handleToggle = (channel: number) => {
    onSelectChannel(selectedChannel === channel ? null : channel);
  };

  // Track which channel is being dragged-over and which zone (mode).
  //
  // Pattern: source of truth is `onDragOver`, which fires continuously
  // while the cursor sits over a row. We update state on every
  // dragOver (cheaply — only commits a change when channel/mode
  // actually flip). We don't use dragEnter / dragLeave at all — those
  // are notoriously flaky because dragLeave fires when the cursor
  // crosses into a child element, even though the cursor is still
  // visually inside the row. The result: the highlight tracks the
  // cursor reliably without dropouts. (Issue raised in testing
  // 2026-04-28: drop zones flickered.)
  //
  // Cleared on drop, on dragend, and on a dragover-in-empty-area
  // safety net registered at window level.
  const [dragOver, setDragOver] = useState<{
    channel: number;
    mode: DropMode;
    /** Cached feasibility: false means the cascade has no empty
     *  channel to land in, so the drop will be refused. */
    blocked: boolean;
  } | null>(null);

  // Clear the highlight when ANY drag ends (drop, cancel, or out of
  // window) so it doesn't get stuck after the cursor leaves the grid.
  useEffect(() => {
    const onEnd = () => setDragOver(null);
    window.addEventListener("dragend", onEnd);
    return () => window.removeEventListener("dragend", onEnd);
  }, []);

  /**
   * Compute drop mode from cursor Y vs row rect.
   *
   *   - Empty row: always `replace` (no shift makes sense — there's
   *     nothing to shift).
   *   - Occupied row: top SHIFT_EDGE_PX → shiftDown; bottom SHIFT_EDGE_PX
   *     → shiftUp; middle → replace.
   *
   * Direction note: dropping near the top edge pushes the existing
   * file *away from the cursor*, so it moves DOWN to channel + 1.
   * Dropping near the bottom edge pushes existing UP. This is the
   * "scoot existing out of the way" mental model — the dragged file
   * lands at the cursor position, and existing yields in the
   * opposite direction.
   */
  const computeMode = (
    e: React.DragEvent,
    isOccupied: boolean,
  ): DropMode => {
    if (!isOccupied) return "replace";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < SHIFT_EDGE_PX) return "shiftDown";
    if (y > rect.height - SHIFT_EDGE_PX) return "shiftUp";
    return "replace";
  };

  /**
   * Feasibility check for the cascade shift: is there an empty
   * channel in the requested direction?
   *
   * Mirrors `cascadeShift` in SongEditor (which is the source of
   * truth) but only computes the boolean — no array manipulation.
   * Used during dragOver to render a "blocked" indicator before the
   * user drops on an impossible target.
   */
  const canCascadeShift = (target: number, direction: -1 | 1): boolean => {
    const occupied = new Set(song.audioFiles.map((f) => f.channel));
    if (direction === -1) {
      for (let i = target - 1; i >= 0; i--) {
        if (!occupied.has(i)) return true;
      }
    } else {
      for (let i = target + 1; i < MIDI_CHANNEL_INDEX; i++) {
        if (!occupied.has(i)) return true;
      }
    }
    return false;
  };

  const handleDrop = (channel: number, e: React.DragEvent) => {
    e.preventDefault();
    const mode = dragOver?.channel === channel ? dragOver.mode : "replace";
    setDragOver(null);
    const payload = readDragPayload(e);
    if (!payload) return;
    if (payload.kind === "source-file") {
      onDropFile(payload.file, channel, mode);
    } else if (payload.kind === "channel-move") {
      // Dropping a channel onto itself is a no-op regardless of mode.
      if (payload.sourceChannel === channel) return;
      onMoveChannel(payload.sourceChannel, channel, mode);
    }
    // Other payload kinds (playlist-row, available-song) are ignored —
    // they belong to PlaylistEditor's drop targets.
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800">
      <header
        className={`grid ${COLS} shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50`}
      >
        <span className="text-right">Ch</span>
        <span>Label</span>
        <span /> {/* icon slot */}
        <span>File</span>
        <span className="text-right">Lvl</span>
        <span className="text-right">Pan</span>
        <span />
      </header>
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: TRACK_MAP_CHANNEL_COUNT }).map((_, idx) => {
          const isSelected = selectedChannel === idx;
          const isMidiSlot = idx === MIDI_CHANNEL_INDEX;
          const isDragOver = dragOver?.channel === idx;
          const dragMode = isDragOver ? dragOver.mode : null;
          const dragBlocked = isDragOver ? dragOver.blocked : false;
          const isOccupied =
            (idx === MIDI_CHANNEL_INDEX
              ? midi !== undefined
              : audioByChannel.has(idx));
          const dndProps = {
            onDragOver: (e: React.DragEvent) => {
              // Always preventDefault on dragOver to allow drop. We
              // can't reliably gate on dataTransfer.types in WebKit
              // (custom MIME types are scrubbed during dragover), so
              // the drop handler validates payload shape and silently
              // no-ops on mismatch.
              e.preventDefault();
              e.dataTransfer.dropEffect =
                readDragPayload(e)?.kind === "channel-move"
                  ? "move"
                  : "copy";
              const mode = computeMode(e, isOccupied);
              const blocked =
                mode === "shiftUp"
                  ? !canCascadeShift(idx, -1)
                  : mode === "shiftDown"
                    ? !canCascadeShift(idx, 1)
                    : false;
              setDragOver((cur) =>
                cur?.channel === idx &&
                cur.mode === mode &&
                cur.blocked === blocked
                  ? cur
                  : { channel: idx, mode, blocked },
              );
            },
            onDrop: (e: React.DragEvent) => handleDrop(idx, e),
          };
          if (isMidiSlot) {
            return (
              <MidiRow
                key="midi"
                label={channelLabels[idx] ?? "MIDI"}
                filename={midi?.filename ?? null}
                isSelected={isSelected}
                isDragOver={isDragOver}
                dragMode={dragMode}
                dragBlocked={dragBlocked}
                onClick={() => handleToggle(idx)}
                onClear={onClearChannel}
                dndProps={dndProps}
              />
            );
          }
          const file = audioByChannel.get(idx);
          const channelRate = channelSampleRates.get(idx);
          const hasRateMismatch =
            file !== undefined &&
            channelRate !== undefined &&
            channelRate > 0 &&
            channelRate !== songRate;
          return (
            <AudioRow
              key={idx}
              index={idx}
              label={channelLabels[idx] ?? `Ch ${idx + 1}`}
              filename={file?.filename ?? null}
              level={file?.level ?? null}
              pan={file?.pan ?? null}
              muted={file ? file.mute === 0 : false}
              isLongest={
                file !== undefined && file.filename === longestFilename
              }
              longestDurationLabel={longestDurationLabel}
              hasRateMismatch={hasRateMismatch}
              channelRate={channelRate ?? null}
              songRate={songRate}
              isSelected={isSelected}
              isDragOver={isDragOver}
              dragMode={dragMode}
              dragBlocked={dragBlocked}
              meta={channelMeta.get(idx)}
              onClick={() => handleToggle(idx)}
              onSwap={onSwapChannel}
              onClear={onClearChannel}
              dndProps={dndProps}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function AudioRow({
  index,
  label,
  filename,
  level,
  pan,
  muted,
  isLongest,
  longestDurationLabel,
  hasRateMismatch,
  channelRate,
  songRate,
  isSelected,
  isDragOver,
  dragMode,
  dragBlocked,
  meta,
  onClick,
  onSwap,
  onClear,
  dndProps,
}: {
  index: number;
  label: string;
  filename: string | null;
  level: number | null;
  pan: number | null;
  muted: boolean;
  isLongest: boolean;
  longestDurationLabel: string;
  hasRateMismatch: boolean;
  channelRate: number | null;
  songRate: number;
  isSelected: boolean;
  isDragOver: boolean;
  /** When dragging over, which zone the cursor is in. */
  dragMode: DropMode | null;
  /** When `dragMode` is a shift, whether the cascade has nowhere to land. */
  dragBlocked: boolean;
  /** Cached WAV metadata for this row's assignment, if known. */
  meta: ChannelMeta | undefined;
  onClick: () => void;
  /** Swap this channel's assignment with another channel's. */
  onSwap: (a: number, b: number) => void;
  /** Clear this channel's assignment. */
  onClear: () => void;
  dndProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}) {
  const isAssigned = filename !== null;
  const longestTooltip = `Longest file in this song (${longestDurationLabel}) — its length sets the song's overall duration. The BandMate plays through until this file ends.`;
  const rateMismatchTooltip = hasRateMismatch && channelRate !== null
    ? `Sample rate mismatch — file is ${channelRate / 1000} kHz but this song is set to ${songRate / 1000} kHz. The BandMate requires every WAV in a song to match the song's sample rate. Change the song's rate or replace this file.`
    : "";
  return (
    <button
      type="button"
      onClick={onClick}
      // Assigned rows can be dragged onto another channel to move
      // the assignment (file + level/pan/mute + any pending copy).
      draggable={isAssigned}
      onDragStart={(e) => {
        if (!isAssigned) return;
        setDragPayload(e, { kind: "channel-move", sourceChannel: index });
        // Custom drag image — filename + spec line so the user
        // can see what they're dragging at a glance. Falls back to
        // just the filename if metadata hasn't loaded yet.
        const metaLine = formatMetaLine(meta);
        const ghostLabel = metaLine
          ? `${filename}  ·  ${metaLine}`
          : (filename ?? "");
        setDragImageLabel(e, ghostLabel);
      }}
      {...dndProps}
      className={cn(
        // `relative` so the ::before/::after insertion-line markers
        // and the selected-row accent bar (rendered as an absolute
        // child below) can position against the row.
        `relative grid ${COLS} w-full items-center gap-2 border-b px-3 py-1 text-left transition-colors`,
        isAssigned && "cursor-grab active:cursor-grabbing",
        // ---- Drag-zone visuals (highest priority — what the user's
        // reacting to right now). Strong, distinct from selected. ----
        // Replace: full ring + saturated bg.
        isDragOver && dragMode === "replace" &&
          "bg-brand-200 ring-2 ring-inset ring-brand-500 dark:bg-brand-900/60 dark:ring-brand-400",
        // Shift: insertion line at the cursor edge + a faint zinc
        // tint to keep visual focus on the line itself. The line color
        // flips red when the cascade is blocked (no empty channel).
        isDragOver && dragMode !== "replace" &&
          "bg-zinc-100 dark:bg-zinc-800/60",
        isDragOver && dragMode === "shiftDown" && !dragBlocked &&
          "before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 before:bg-brand-500 before:content-['']",
        isDragOver && dragMode === "shiftUp" && !dragBlocked &&
          "after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-1 after:bg-brand-500 after:content-['']",
        isDragOver && dragMode === "shiftDown" && dragBlocked &&
          "before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 before:bg-red-500 before:content-['']",
        isDragOver && dragMode === "shiftUp" && dragBlocked &&
          "after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-1 after:bg-red-500 after:content-['']",
        // ---- Resting / hover / selected. Distinct hue intensities so
        // the user can tell them apart at a glance. ----
        !isDragOver &&
          (isSelected
            // Selected: medium-saturated brand bg. The accent bar (rendered
            // as an absolute child below) carries the strong "this row
            // is selected" signal so the bg can stay subtle and not
            // compete with the dropzone-replace bg.
            ? "border-zinc-100 bg-brand-50 dark:border-zinc-900 dark:bg-brand-950/30"
            : hasRateMismatch
              ? "border-zinc-100 bg-red-50/40 hover:bg-red-100/60 dark:border-zinc-900 dark:bg-red-950/20 dark:hover:bg-red-950/40"
              // Idle/hover: visibly grayer hover state than before
              // (zinc-100 vs zinc-50) so it reads as a real hover
              // signal, not just a rendering artifact.
              : "border-zinc-100 hover:bg-zinc-100 dark:border-zinc-900 dark:hover:bg-zinc-800/60"),
      )}
      aria-pressed={isSelected}
    >
      {/* Selected-row accent bar — 3px brand-color stripe at the
          left edge. Distinct from any drag-state visual. */}
      {isSelected && !isDragOver && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-brand-500"
        />
      )}
      {isDragOver && (
        <DropZoneLabel mode={dragMode} blocked={dragBlocked} />
      )}
      <span
        className={cn(
          "text-right font-mono text-xs tabular-nums",
          isSelected
            ? "text-brand-700 dark:text-brand-300"
            : "text-zinc-500",
        )}
      >
        {index + 1}
      </span>
      <span
        className={cn(
          "truncate text-xs",
          isSelected
            ? "text-brand-900 dark:text-brand-100"
            : "text-zinc-700 dark:text-zinc-300",
        )}
        title={label}
      >
        {label || <span className="italic text-zinc-400">unnamed</span>}
      </span>
      {/* Icon slot — always present so filename column stays aligned.
          Rate-mismatch (error) takes precedence over the longest indicator. */}
      <span className="flex items-center justify-center">
        {isAssigned && hasRateMismatch ? (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
            title={rateMismatchTooltip}
            aria-label={rateMismatchTooltip}
          >
            <WarningIcon className="h-3 w-3" />
          </span>
        ) : isAssigned && isLongest ? (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            title={longestTooltip}
            aria-label={longestTooltip}
          >
            <StopwatchIcon className="h-3 w-3" />
          </span>
        ) : null}
      </span>
      <span
        className="user-text truncate font-mono text-xs"
        title={(() => {
          // Tooltip content stacks: filename → spec line ("44.1 kHz ·
          // mono · 3:21") → severity / longest annotation if any.
          const metaLine = formatMetaLine(meta);
          const lines: string[] = [];
          if (filename) lines.push(filename);
          if (metaLine) lines.push(metaLine);
          if (hasRateMismatch) {
            lines.push("");
            lines.push(rateMismatchTooltip);
          } else if (isLongest) {
            lines.push("");
            lines.push(longestTooltip);
          }
          return lines.join("\n");
        })()}
      >
        {isAssigned ? (
          <span
            className={cn(
              muted
                ? "text-zinc-400 line-through"
                : hasRateMismatch
                  ? "text-red-700 dark:text-red-400"
                  : isSelected
                    ? "text-brand-900 dark:text-brand-100"
                    : "text-zinc-700 dark:text-zinc-300",
            )}
          >
            {filename}
          </span>
        ) : (
          <span className="italic text-zinc-400 dark:text-zinc-600">—</span>
        )}
      </span>
      <span
        className={cn(
          "text-right font-mono text-xs tabular-nums",
          isSelected ? "text-brand-700 dark:text-brand-300" : "text-zinc-500",
        )}
      >
        {level !== null ? level.toFixed(1) : "—"}
      </span>
      <span
        className={cn(
          "text-right font-mono text-xs tabular-nums",
          isSelected ? "text-brand-700 dark:text-brand-300" : "text-zinc-500",
        )}
      >
        {pan !== null ? pan.toFixed(1) : "—"}
      </span>
      {/* Trailing slot: on-row ↑ / ↓ / × buttons appear here when the
          row is selected and has an assignment. Clicks stop propagating
          so they don't toggle the row's selection. */}
      <span className="flex items-center justify-end gap-0.5">
        {isSelected && isAssigned && (
          <>
            <RowActionButton
              onClick={(e) => {
                e.stopPropagation();
                onSwap(index, index - 1);
              }}
              disabled={index === 0}
              title="Move up (⌘↑)"
              ariaLabel="Move up"
            >
              <ArrowUpIcon className="h-3 w-3" />
            </RowActionButton>
            <RowActionButton
              onClick={(e) => {
                e.stopPropagation();
                onSwap(index, index + 1);
              }}
              disabled={index === MIDI_CHANNEL_INDEX - 1}
              title="Move down (⌘↓)"
              ariaLabel="Move down"
            >
              <ArrowDownIcon className="h-3 w-3" />
            </RowActionButton>
            <RowActionButton
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              title="Clear assignment (Delete)"
              ariaLabel="Clear assignment"
              danger
            >
              <CloseIcon className="h-3 w-3" />
            </RowActionButton>
          </>
        )}
      </span>
    </button>
  );
}

/**
 * Drop-zone label rendered inside a channel row during dragOver, to
 * tell the user what the upcoming drop will do.
 *
 * Position rationale: pinned to the LEFT side of the row so it
 * doesn't sit underneath the drag image. The browser positions the
 * drag image at `cursor + (12, 16)` (see `setDragImageLabel`), so
 * the lower-right of the cursor is occupied — the left edge of the
 * row is the safe zone. The label covers the channel-# column
 * mid-drag, but that's transient and the row's bg highlight still
 * conveys which row is targeted.
 *
 *   - shiftDown (top edge): label pinned to top-left
 *   - shiftUp (bottom edge): label pinned to bottom-left
 *   - replace (middle): label pinned center-left
 *
 * `pointer-events-none` so the label doesn't disrupt drag events on
 * the row underneath.
 */
function DropZoneLabel({
  mode,
  blocked,
}: {
  mode: DropMode | null;
  blocked: boolean;
}) {
  if (!mode) return null;
  if (blocked && mode !== "replace") {
    const positionCls =
      mode === "shiftDown" ? "top-0.5 left-2" : "bottom-0.5 left-2";
    return (
      <span
        className={cn(
          "pointer-events-none absolute z-20 inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow",
          positionCls,
        )}
      >
        <NoEntryIcon className="h-3 w-3" />
        No empty channel
      </span>
    );
  }
  if (mode === "replace") {
    return (
      <span
        className="pointer-events-none absolute left-2 top-1/2 z-20 inline-flex -translate-y-1/2 items-center gap-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow"
      >
        Replace
      </span>
    );
  }
  // shiftUp / shiftDown
  const isShiftUp = mode === "shiftUp";
  const positionCls = isShiftUp ? "bottom-0.5 left-2" : "top-0.5 left-2";
  const arrow = isShiftUp ? (
    <ArrowUpIcon className="h-3 w-3" />
  ) : (
    <ArrowDownIcon className="h-3 w-3" />
  );
  const text = isShiftUp ? "Push existing up" : "Push existing down";
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

/**
 * Square icon button used for the on-row ↑ / ↓ / × actions when a
 * channel is selected. Brand-color hover for moves, red for the
 * destructive clear action. Disabled state for boundary moves.
 */
function RowActionButton({
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

/** Small "×" close glyph. */
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

function NoEntryIcon({ className }: { className?: string }) {
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
      <circle cx="8" cy="8" r="6" />
      <path d="M4 8h8" />
    </svg>
  );
}

/**
 * Inline warning triangle (with exclamation) used for sample-rate
 * mismatch and other hard errors that need to fit in the 16px icon
 * slot. Single glyph reads as "this row has a problem" at a glance;
 * the tooltip + red row tint carry the specifics.
 *
 * Path is Heroicons mini's `ExclamationTriangleIcon` (20×20 viewBox).
 * Heroicons hand-tuned the geometry for ≤16px rendering — clean
 * straight edges, no thin-line artifacts at the bottom — which our
 * earlier hand-rolled path was suffering from.
 */
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

/**
 * Inline stopwatch icon used to mark the longest audio file. Strong
 * timer/duration affordance — pairs naturally with the tooltip.
 */
function StopwatchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 1.5h4" />
      <path d="M8 1.5v2" />
      <circle cx="8" cy="9.5" r="4.5" />
      <path d="M8 9.5l2.4-2" />
    </svg>
  );
}

function MidiRow({
  label,
  filename,
  isSelected,
  isDragOver,
  dragMode,
  dragBlocked,
  onClick,
  onClear,
  dndProps,
}: {
  label: string;
  filename: string | null;
  isSelected: boolean;
  isDragOver: boolean;
  dragMode: DropMode | null;
  dragBlocked: boolean;
  onClick: () => void;
  /** Clear the MIDI assignment. */
  onClear: () => void;
  dndProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}) {
  // MIDI slot is fixed at index 24, so shift modes don't really apply
  // — but we still highlight the same way (the parent caps mode at
  // "replace" for the MIDI slot anyway, since computeMode only
  // returns shifts for occupied non-MIDI rows in practice).
  return (
    <button
      type="button"
      onClick={onClick}
      {...dndProps}
      className={cn(
        `relative grid ${COLS} w-full items-center gap-2 border-b px-3 py-1 text-left transition-colors`,
        // Drag-zone visuals (matches AudioRow palette).
        isDragOver && dragMode === "replace" &&
          "bg-brand-200 ring-2 ring-inset ring-brand-500 dark:bg-brand-900/60 dark:ring-brand-400",
        isDragOver && dragMode !== "replace" &&
          "bg-zinc-100 dark:bg-zinc-800/60",
        isDragOver && dragMode === "shiftDown" && !dragBlocked &&
          "before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 before:bg-brand-500 before:content-['']",
        isDragOver && dragMode === "shiftUp" && !dragBlocked &&
          "after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-1 after:bg-brand-500 after:content-['']",
        // Resting / selected.
        !isDragOver &&
          (isSelected
            ? "border-zinc-200 bg-brand-50 dark:border-zinc-800 dark:bg-brand-950/30"
            : "border-zinc-200 bg-green-50/40 hover:bg-green-100/60 dark:border-zinc-800 dark:bg-green-950/10 dark:hover:bg-green-900/30"),
      )}
      aria-pressed={isSelected}
    >
      {isSelected && !isDragOver && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-brand-500"
        />
      )}
      {isDragOver && (
        <DropZoneLabel mode={dragMode} blocked={dragBlocked} />
      )}
      <span className="text-right font-mono text-[10px] uppercase tabular-nums text-green-700 dark:text-green-500">
        MID
      </span>
      <span
        className={cn(
          "truncate text-xs",
          isSelected
            ? "text-brand-900 dark:text-brand-100"
            : "text-zinc-700 dark:text-zinc-300",
        )}
        title={label}
      >
        {label || <span className="italic text-zinc-400">unnamed</span>}
      </span>
      <span /> {/* icon slot */}
      <span
        className="user-text truncate font-mono text-xs"
        title={filename ?? ""}
      >
        {filename ? (
          <span
            className={
              isSelected
                ? "text-brand-900 dark:text-brand-100"
                : "text-zinc-700 dark:text-zinc-300"
            }
          >
            {filename}
          </span>
        ) : (
          <span className="italic text-zinc-400 dark:text-zinc-600">—</span>
        )}
      </span>
      <span />
      <span />
      {/* Trailing slot: × button when MIDI is selected and has an
          assignment. MIDI can't move (slot 24 is fixed), so no
          ↑ / ↓ buttons. */}
      <span className="flex items-center justify-end gap-0.5">
        {isSelected && filename !== null && (
          <RowActionButton
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            title="Clear MIDI assignment (Delete)"
            ariaLabel="Clear MIDI assignment"
            danger
          >
            <CloseIcon className="h-3 w-3" />
          </RowActionButton>
        )}
      </span>
    </button>
  );
}
