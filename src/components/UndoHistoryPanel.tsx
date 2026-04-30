/**
 * Undo History panel — modal list of every snapshot in the editor's
 * past / current / future stack. Click any entry to jump straight to
 * that snapshot.
 *
 * Trigger: ⌥⌘Z in any editor (handled by each editor's keydown
 * effect — this component just renders the panel).
 *
 * Snapshots don't carry intent metadata in v0.1, so entries are
 * labeled by index ("Edit 5", "Edit 4", …, "Initial state"). The
 * "Current" and "Saved" markers help orient.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │ Undo History         (×)    │
 *   ├─────────────────────────────┤
 *   │ Edit 8                      │
 *   │ Edit 7                      │
 *   │ Edit 6  ← Current  ✓ Saved  │
 *   │ Edit 5                      │
 *   │ ...                         │
 *   │ Initial state               │
 *   └─────────────────────────────┘
 *
 * Newest at the top: most apps' undo histories are listed
 * recent-first, which matches the user's mental model when they
 * press ⌥⌘Z to "undo a few steps."
 */

import { useEffect } from "react";
import { cn } from "../lib/cn";

interface Props {
  isOpen: boolean;
  /** How many snapshots are in `past`. Their indices are 0..pastCount-1. */
  pastCount: number;
  /** How many snapshots are in `future`. Their indices are pastCount+1..end. */
  futureCount: number;
  /**
   * Index of the baseline snapshot in the flat list, or null if no
   * baseline (e.g., never saved). Used to mark the "✓ Saved" entry.
   */
  baselineIndex: number | null;
  /**
   * Optional one-line descriptions of each entry, indexed by flat-list
   * position. Length must equal pastCount + 1 + futureCount when
   * provided. Index 0 conventionally describes the initial state
   * ("Initial state"); index N>=1 describes the edit that PRODUCED
   * the snapshot at N (i.e. the diff between N-1 and N). Falls back
   * to "Initial state" / "Edit N" when omitted.
   */
  entryLabels?: string[];
  /** Called with a flat-list index when the user clicks an entry. */
  onJumpTo: (index: number) => void;
  onClose: () => void;
}

export function UndoHistoryPanel({
  isOpen,
  pastCount,
  futureCount,
  baselineIndex,
  entryLabels,
  onJumpTo,
  onClose,
}: Props) {
  // ESC closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Build a flat list, newest first. The current snapshot lives
  // immediately after `past` in the chronological order:
  //   chronological: [past[0], past[1], ..., past[n-1], current, future[0], ...]
  //   indices:        [0,        1,       ..., n-1,      n,       n+1, ...]
  // We show newest first, so we reverse for display purposes (but
  // keep indices aligned with the chronological order — that's what
  // onJumpTo expects).
  const total = pastCount + 1 + futureCount;
  const currentIndex = pastCount;
  const entries = Array.from({ length: total }, (_, i) => i).reverse();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="undo-history-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 dark:bg-zinc-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2
            id="undo-history-title"
            className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            Undo History
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history panel"
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </header>

        <ul className="flex-1 overflow-y-auto py-1">
          {entries.map((idx) => {
            const isCurrent = idx === currentIndex;
            const isBaseline = idx === baselineIndex;
            const isInitial = idx === 0;
            const fallback = isInitial ? "Initial state" : `Edit ${idx}`;
            const label = entryLabels?.[idx] ?? fallback;
            return (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => onJumpTo(idx)}
                  disabled={isCurrent}
                  title={label}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left text-sm transition",
                    isCurrent
                      ? "cursor-default bg-brand-50 dark:bg-brand-950/30"
                      : "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 font-mono text-2xs tabular-nums",
                        isCurrent
                          ? "text-brand-700 dark:text-brand-300"
                          : "text-zinc-400 dark:text-zinc-600",
                      )}
                    >
                      {idx.toString().padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "truncate",
                        isCurrent
                          ? "font-semibold text-brand-900 dark:text-brand-100"
                          : "text-zinc-700 dark:text-zinc-300",
                      )}
                    >
                      {label}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {isCurrent && (
                      <span className="rounded bg-brand-500 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider text-white">
                        Current
                      </span>
                    )}
                    {isBaseline && (
                      <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider text-white">
                        Saved
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <footer className="shrink-0 border-t border-zinc-200 px-5 py-2 text-meta text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {total === 1
            ? "Nothing to undo yet."
            : `${total} snapshots. Click any entry to jump there. ⌘Z / ⇧⌘Z still work.`}
        </footer>
      </div>
    </div>
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
