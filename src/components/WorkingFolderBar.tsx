/**
 * Top app chrome: branding on the left, working folder display +
 * actions on the right.
 *
 * Right-side layout (single row, header stays compact):
 *
 *   [↻]  [ WORKING FOLDER │ .../bm-stick ]  [Change]
 *
 * The "Working Folder" label lives INSIDE the path chip as a labeled
 * prefix, separated from the path by a thin vertical divider. This
 * keeps everything on one row (no extra header height) while still
 * making the chip self-describing — anyone glancing at the toolbar
 * sees "this is the working folder, and it's set to .../bm-stick"
 * without any tooltip needed.
 */

import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";

export function WorkingFolderBar() {
  const { state, chooseWorkingFolder, rescan } = useAppState();
  const path = state.workingFolder;
  if (!path) return null;
  const isLoading = state.status === "loading";

  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-base text-white"
          aria-hidden="true"
        >
          ♪
        </div>
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          BandMate Studio
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <IconButton
          onClick={() => {
            void rescan();
          }}
          disabled={isLoading}
          title={isLoading ? "Scanning…" : "Re-scan working folder"}
        >
          <RefreshIcon className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </IconButton>
        <WorkingFolderChip path={path} />
        <button
          type="button"
          onClick={() => {
            void chooseWorkingFolder();
          }}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:focus-visible:ring-offset-zinc-950"
        >
          Change
        </button>
      </div>
    </header>
  );
}

/**
 * Self-describing labeled chip.
 *
 * Visual structure:
 *   [ WORKING FOLDER │ …/eric/Documents/bm-stick ]
 *     └── label ──┘ │ └────── path tail ──────┘
 *
 * The label and path share one rounded background, separated by a thin
 * vertical divider. The full path is exposed via the `title` attribute
 * for hover.
 */
function WorkingFolderChip({ path }: { path: string }) {
  // Show the trailing 3 path segments — keeps the project-identifying
  // suffix visible when paths are deep.
  const parts = path.split("/").filter(Boolean);
  const tail = parts.slice(-3).join("/");
  const isTruncated = parts.length > 3;

  return (
    <span
      className="user-text inline-flex h-[30px] max-w-[520px] items-center gap-2 rounded-md bg-zinc-100 pl-2.5 pr-2.5 dark:bg-zinc-900"
      title={path}
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
        Working Folder
      </span>
      <span
        aria-hidden="true"
        className="h-3.5 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700"
      />
      <span className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {isTruncated ? "…/" : "/"}
        {tail}
      </span>
    </span>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-300 dark:focus-visible:ring-offset-zinc-950"
    >
      {children}
    </button>
  );
}

/** Inline circular-arrow refresh icon. */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M2 8a6 6 0 0 1 10.5-3.95" />
      <path d="M14 8a6 6 0 0 1-10.5 3.95" />
      <path d="M12.5 1.5v3h-3" />
      <path d="M3.5 14.5v-3h3" />
    </svg>
  );
}
