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

import { useState } from "react";
import { useAppState } from "../state/AppState";
import { cn } from "../lib/cn";
import { revealInFileManager } from "../fs/workingFolder";
import { ContextMenu, type OpenContextMenu } from "./ContextMenu";
import { ExportToUsbDialog } from "./ExportToUsbDialog";
import { SettingsDialog } from "./SettingsDialog";
import joecoLogoNeon from "../assets/joeco-logo-neon.png";
import joecoLogoWhite from "../assets/joeco-logo-white.png";

export function WorkingFolderBar() {
  const { state, chooseWorkingFolder, rescan } = useAppState();
  const path = state.workingFolder;
  const [contextMenu, setContextMenu] = useState<OpenContextMenu | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!path) return null;
  const isLoading = state.status === "loading";

  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex min-w-0 items-center gap-3">
        {/* JoeCo logo. The neon variant works on light backgrounds; the
            white variant goes against dark mode. Tailwind's dark:
            variant on the wrapper hides the inactive one. The native
            aspect (166×57) gives a ~2.9:1 ratio; height-locked to 28px
            so it sits comfortably alongside the title text without
            inflating the header. */}
        <picture>
          <img
            src={joecoLogoNeon}
            alt="JoeCo"
            className="block h-7 w-auto dark:hidden"
            draggable={false}
          />
          <img
            src={joecoLogoWhite}
            alt="JoeCo"
            className="hidden h-7 w-auto dark:block"
            draggable={false}
          />
        </picture>
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
        <WorkingFolderChip
          path={path}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({
              position: { x: e.clientX, y: e.clientY },
              items: [
                {
                  label: "Open in Finder",
                  onClick: () => void revealInFileManager(path),
                },
              ],
            });
          }}
        />
        <button
          type="button"
          onClick={() => {
            void chooseWorkingFolder();
          }}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:focus-visible:ring-offset-zinc-950"
        >
          Change
        </button>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          disabled={isLoading}
          title="Copy bm_media/ onto a USB stick"
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-zinc-950"
        >
          Export to USB
        </button>
        <IconButton onClick={() => setSettingsOpen(true)} title="Settings">
          <GearIcon className="h-4 w-4" />
        </IconButton>
      </div>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <ExportToUsbDialog
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
      />
      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
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
function WorkingFolderChip({
  path,
  onContextMenu,
}: {
  path: string;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  // Show the trailing 3 path segments — keeps the project-identifying
  // suffix visible when paths are deep.
  const parts = path.split("/").filter(Boolean);
  const tail = parts.slice(-3).join("/");
  const isTruncated = parts.length > 3;

  return (
    <span
      className="user-text inline-flex h-[30px] max-w-[520px] items-center gap-2 rounded-md bg-zinc-100 pl-2.5 pr-2.5 dark:bg-zinc-900"
      title={path}
      onContextMenu={onContextMenu}
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

/**
 * Inline gear icon — opens the Settings page. Standard 8-tooth
 * sprocket with a center hole; matches the affordance most desktop
 * apps use for "Settings".
 *
 * Path is hand-crafted: the outer shape is a 24-vertex polygon
 * alternating between a tooth tip (radius 11) and a tooth root
 * (radius 7.7), with each pair offset 22.5° from the previous —
 * yielding the classic gear silhouette in a small viewBox. The inner
 * circle (r=3.5) is the hub. Both are stroked, matching the rest of
 * our header iconography.
 */
function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M19.4 14.5a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V20.5a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 5 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9.5A1.65 1.65 0 0 0 10.5 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
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
