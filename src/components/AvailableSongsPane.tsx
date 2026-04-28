/**
 * Right-rail pane in the playlist editor: lists every song under
 * `bm_sources/` that *isn't* already in the current playlist.
 *
 * Click a row to append it to the playlist (the parent decides where
 * — currently appends to the end). When all available songs are
 * already in the playlist, the pane shows an empty state.
 *
 * v1 keeps the per-row info minimal (just folder name). Phase 4.8
 * will extend rows with sample-rate badges so users can spot rate
 * mismatches before adding.
 */

import type { SongSummary } from "../fs/types";
import { cn } from "../lib/cn";
import { setDragImageLabel, setDragPayload } from "../lib/dnd";

interface Props {
  /** All songs from the working folder's bm_sources/. */
  allSongs: SongSummary[];
  /**
   * Folder names of songs already in the playlist (i.e. <song_name>
   * entries from the .jcp). We hide these from the list to make
   * "what can I add right now" obvious.
   */
  inPlaylist: Set<string>;
  /** Append the given song's folder name to the playlist. */
  onAdd: (folderName: string) => void;
}

export function AvailableSongsPane({ allSongs, inPlaylist, onAdd }: Props) {
  const available = allSongs.filter((s) => !inPlaylist.has(s.folderName));
  const hasAny = allSongs.length > 0;
  const hasAvailable = available.length > 0;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900/40">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Available Songs
          </h2>
          <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {available.length}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          Songs in your working folder that aren't in this playlist yet. Click
          one to append it to the end.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!hasAny && (
          <PaneInfo>
            No songs in this working folder yet. Use{" "}
            <strong>+ New Song</strong> in the sidebar to create one.
          </PaneInfo>
        )}
        {hasAny && !hasAvailable && (
          <PaneInfo>
            Every song in the working folder is already in this playlist.
          </PaneInfo>
        )}
        {hasAvailable && (
          <ul>
            {available.map((song) => (
              <li key={song.jcsPath}>
                <button
                  type="button"
                  onClick={() => onAdd(song.folderName)}
                  draggable
                  onDragStart={(e) => {
                    setDragPayload(e, {
                      kind: "available-song",
                      folderName: song.folderName,
                    });
                    setDragImageLabel(e, song.folderName);
                  }}
                  title={`Click to append "${song.folderName}", or drag to insert at a specific spot`}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 border-b border-zinc-100 px-4 py-1.5 text-left transition-colors last:border-b-0 dark:border-zinc-900",
                    "cursor-grab hover:bg-white active:cursor-grabbing dark:hover:bg-zinc-950",
                  )}
                >
                  <span className="user-text truncate text-sm text-zinc-700 dark:text-zinc-300">
                    {song.folderName}
                  </span>
                  <PlusIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400 group-hover:text-zinc-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function PaneInfo({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-3 text-xs italic text-zinc-500 dark:text-zinc-600">
      {children}
    </p>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
