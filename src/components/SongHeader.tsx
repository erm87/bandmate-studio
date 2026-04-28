/**
 * Song editor's header strip. Single horizontal row to keep vertical
 * footprint minimal so the channel grid below has room for all 25 rows.
 *
 * Layout:
 *   [Song Name •]  [44.1 / 48 kHz]  3:21 · 9 files  [Track Map ▼]  [Save]
 *
 *   - "•" is the dirty indicator: shows when draft differs from disk.
 *   - Sample rate is an editable radio pair. The state is read from
 *     the draft each render so flipping it doesn't bug-out and revert
 *     the way BM Loader's New Song dialog did.
 *   - Save button is enabled only when dirty + not saving.
 */

import type { TrackMapSummary } from "../fs/types";
import { cn } from "../lib/cn";

interface Props {
  songName: string;
  sampleRate: number;
  durationSamples: number;
  fileCount: number;
  trackMaps: TrackMapSummary[];
  trackMapPath: string | null;
  onPickTrackMap: (path: string) => void;
  onSampleRateChange: (sampleRate: number) => void;
  isDirty: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function SongHeader({
  songName,
  sampleRate,
  durationSamples,
  fileCount,
  trackMaps,
  trackMapPath,
  onPickTrackMap,
  onSampleRateChange,
  isDirty,
  saving,
  saveError,
  onSave,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: Props) {
  const seconds = sampleRate > 0 ? durationSamples / sampleRate : 0;
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  const durationLabel = `${mm}:${ss.toString().padStart(2, "0")}`;

  return (
    <header className="flex shrink-0 flex-col gap-1 border-b border-zinc-200 bg-white px-6 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-4">
        <h1
          className="user-text flex min-w-0 flex-1 items-center gap-2 truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          title={songName}
        >
          <span className="truncate">{songName}</span>
          {isDirty && (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          )}
        </h1>

        <SampleRateRadio
          sampleRate={sampleRate}
          onChange={onSampleRateChange}
        />

        <div className="flex shrink-0 items-center gap-3 font-mono text-xs tabular-nums text-zinc-500">
          <span>{durationLabel}</span>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span>
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </span>
        </div>

        <label className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Track Map
          </span>
          <select
            value={trackMapPath ?? ""}
            onChange={(e) => onPickTrackMap(e.target.value)}
            disabled={trackMaps.length === 0}
            className="user-text rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-xs text-zinc-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
          >
            {trackMaps.length === 0 && <option value="">(none)</option>}
            {trackMaps.map((tm) => (
              <option key={tm.path} value={tm.path}>
                {tm.filename}
              </option>
            ))}
          </select>
        </label>

        <div className="flex shrink-0 items-center gap-1">
          <HistoryButton
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            ariaLabel="Undo"
          >
            <UndoIcon className="h-3.5 w-3.5" />
          </HistoryButton>
          <HistoryButton
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            ariaLabel="Redo"
          >
            <RedoIcon className="h-3.5 w-3.5" />
          </HistoryButton>
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || saving}
          title={isDirty ? "Save (⌘S)" : "No unsaved changes"}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
            isDirty && !saving
              ? "bg-brand-500 text-white hover:bg-brand-600"
              : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600",
          )}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {saveError && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          Save failed: {saveError}
        </p>
      )}
    </header>
  );
}

/**
 * Editable sample-rate radio pair (44.1 / 48 kHz). The selected value
 * comes straight from the prop so there's no internal state to get
 * out of sync — a fix to BM Loader's "select 48 kHz, gets reverted to
 * 44.1 on submit" bug, which was caused by the dialog reading a stale
 * module-level variable instead of the radio's current value.
 */
function SampleRateRadio({
  sampleRate,
  onChange,
}: {
  sampleRate: number;
  onChange: (sampleRate: number) => void;
}) {
  return (
    <fieldset
      role="radiogroup"
      aria-label="Sample rate"
      className="flex shrink-0 items-center gap-2"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Sample Rate
      </span>
      <div
        className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
        // segmented control — looks like a single chip with two halves
      >
        <RateButton
          label="44.1 kHz"
          isActive={sampleRate === 44100}
          onClick={() => onChange(44100)}
        />
        <span
          aria-hidden="true"
          className="w-px self-stretch bg-zinc-200 dark:bg-zinc-800"
        />
        <RateButton
          label="48 kHz"
          isActive={sampleRate === 48000}
          onClick={() => onChange(48000)}
        />
      </div>
    </fieldset>
  );
}

function RateButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      onClick={onClick}
      className={cn(
        "px-2 py-1 font-mono text-xs transition",
        isActive
          ? "bg-brand-500 text-white"
          : "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900",
      )}
    >
      {label}
    </button>
  );
}

/** Square ghost button used for the Undo / Redo icons. */
function HistoryButton({
  children,
  onClick,
  disabled,
  title,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition",
        disabled
          ? "cursor-not-allowed text-zinc-300 dark:text-zinc-700"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}

/** Counterclockwise curved arrow — the conventional undo glyph. */
function UndoIcon({ className }: { className?: string }) {
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
      <path d="M3.5 7.5h6.5a3.5 3.5 0 0 1 0 7H7" />
      <path d="M6 4l-2.5 3.5L6 11" />
    </svg>
  );
}

/** Clockwise curved arrow — the conventional redo glyph (mirror of UndoIcon). */
function RedoIcon({ className }: { className?: string }) {
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
      <path d="M12.5 7.5H6a3.5 3.5 0 0 0 0 7h3" />
      <path d="M10 4l2.5 3.5L10 11" />
    </svg>
  );
}
