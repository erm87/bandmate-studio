/**
 * Track-map editor header strip. Simpler than the song / playlist
 * headers — track maps are just label lists, no sample rate, no
 * cross-reference picker.
 *
 * Layout:
 *   [Track Map Name •]   [Undo] [Redo] [Hist]  [Save]
 *   N of 25 labels
 *
 *   - Label count lives in a caption row under the title for
 *     consistency with the other editor headers.
 *   - "•" is the dirty indicator: shows when draft differs from disk.
 *   - The name is read-only here; renaming happens via right-click in
 *     the sidebar (Phase 4.12) so it can also rename the .jcm file in
 *     one shot, plus update playlists' <trackmap> references.
 */

import { cn } from "../lib/cn";

interface Props {
  trackMapName: string;
  filledCount: number;
  isDirty: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Open the Undo History panel (also available via ⌥⌘Z). */
  onOpenHistory: () => void;
}

export function TrackMapHeader({
  trackMapName,
  filledCount,
  isDirty,
  saving,
  saveError,
  onSave,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenHistory,
}: Props) {
  return (
    <header className="flex shrink-0 flex-col gap-0.5 border-b border-zinc-200 bg-white px-6 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-4">
        <h1
          className="user-text flex min-w-0 flex-1 items-center gap-2 truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          title={trackMapName}
        >
          <span className="truncate">{trackMapName}</span>
          {isDirty && (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          )}
        </h1>

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
          <HistoryButton
            onClick={onOpenHistory}
            disabled={false}
            title="Show undo history (⌥⌘Z)"
            ariaLabel="Show undo history"
          >
            <HistoryIcon className="h-3.5 w-3.5" />
          </HistoryButton>
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || saving}
          title={isDirty ? "Save (⌘S)" : "No unsaved changes"}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2",
            isDirty && !saving
              ? "bg-brand-500 text-white hover:bg-brand-600"
              : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600",
          )}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Caption row — read-only metadata under the title. */}
      <div className="flex items-center gap-2 font-mono text-meta tabular-nums text-zinc-500 dark:text-zinc-500">
        <span>
          {filledCount} of 25 {filledCount === 1 ? "label" : "labels"}
        </span>
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

/** Clock-with-curved-arrow glyph, the conventional "history" icon. */
function HistoryIcon({ className }: { className?: string }) {
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
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2 3v3h3" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  );
}
