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

import { MIDI_CHANNEL_INDEX, TRACK_MAP_CHANNEL_COUNT, type Song } from "../codec";
import { cn } from "../lib/cn";

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
  /** Currently-selected channel index, or null if none. */
  selectedChannel: number | null;
  /** Toggle selection of a channel. Pass `null` to clear. */
  onSelectChannel: (channel: number | null) => void;
}

// Column template:
//   Ch # | Label | (icon slot) | File | Lvl | Pan | (delete slot)
//
// The 16px icon slot between Label and File is always rendered, even
// for rows without the longest indicator, so filenames in the File
// column are left-aligned at the same x-position regardless.
const COLS = "grid-cols-[32px_110px_16px_1fr_40px_40px_24px]";

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
  selectedChannel,
  onSelectChannel,
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
          if (isMidiSlot) {
            return (
              <MidiRow
                key="midi"
                label={channelLabels[idx] ?? "MIDI"}
                filename={midi?.filename ?? null}
                isSelected={isSelected}
                onClick={() => handleToggle(idx)}
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
              onClick={() => handleToggle(idx)}
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
  onClick,
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
  onClick: () => void;
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
      className={cn(
        `grid ${COLS} w-full items-center gap-2 border-b px-3 py-1 text-left transition-colors`,
        isSelected
          ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30"
          : hasRateMismatch
            ? "border-zinc-100 bg-red-50/40 hover:bg-red-100/40 dark:border-zinc-900 dark:bg-red-950/20 dark:hover:bg-red-950/30"
            : "border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/40",
      )}
      aria-pressed={isSelected}
    >
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
        title={
          hasRateMismatch
            ? `${filename}\n\n${rateMismatchTooltip}`
            : isLongest
              ? `${filename}\n\n${longestTooltip}`
              : (filename ?? "")
        }
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
      <span />
    </button>
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
  onClick,
}: {
  label: string;
  filename: string | null;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        `grid ${COLS} w-full items-center gap-2 border-b px-3 py-1 text-left transition-colors`,
        isSelected
          ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30"
          : "border-zinc-200 bg-green-50/40 hover:bg-green-100/40 dark:border-zinc-800 dark:bg-green-950/10 dark:hover:bg-green-900/20",
      )}
      aria-pressed={isSelected}
    >
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
      <span />
    </button>
  );
}
