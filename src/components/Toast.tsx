/**
 * Small non-blocking notification shown in the bottom-right corner.
 *
 * Used today by the editor's "Import all" action to confirm what
 * just happened. Auto-dismisses after a few seconds; can be
 * dismissed manually via the close button. Live region so screen
 * readers announce the message.
 *
 * Deliberately minimal — single message, single severity (tonal
 * brand). If we ever need success/warning/error variants or a
 * queue, extend this; for the one current caller a single tier is
 * enough.
 */

import { useEffect } from "react";

interface Props {
  /** Message text. Re-rendering with a new string resets the dismiss timer. */
  message: string;
  /** Auto-dismiss delay in ms. Defaults to 4 seconds. */
  durationMs?: number;
  /** Called when the toast auto-dismisses or the user clicks the close button. */
  onDismiss: () => void;
}

export function Toast({ message, durationMs = 4000, onDismiss }: Props) {
  // Reset the timer whenever the message changes — back-to-back
  // imports shouldn't have the second toast clipped short by the
  // first toast's leftover timer.
  useEffect(() => {
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [message, durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      // pointer-events-none on the wrapper so the underlying app
      // doesn't get hit-blocked by the toast's bounding box; the
      // toast card itself re-enables pointer events.
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-end px-4"
    >
      <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-800 shadow-lg ring-1 ring-brand-200 dark:bg-brand-950/90 dark:text-brand-100 dark:ring-brand-900/60">
        <span className="leading-snug">{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-0.5 shrink-0 rounded text-brand-600 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 dark:text-brand-300 dark:hover:text-brand-100"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
