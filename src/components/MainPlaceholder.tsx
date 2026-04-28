/**
 * Right-pane placeholder for Phase 2.
 *
 * Phase 3+ will replace this with the actual editor surfaces (Song
 * editor, Playlist editor, Track Map editor) driven by the sidebar
 * selection. For now we just show useful summary stats so Eric has
 * something informative to look at after the scan completes.
 */

import { useAppState } from "../state/AppState";

export function MainPlaceholder() {
  const { state } = useAppState();
  const { songs, playlists, trackMaps } = state.scan;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto bg-white dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-12">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Working folder
          </p>
          <p
            className="user-text mt-1 break-all font-mono text-sm text-zinc-700 dark:text-zinc-300"
            title={state.workingFolder ?? ""}
          >
            {state.workingFolder}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Songs" value={songs.length} />
          <Stat label="Playlists" value={playlists.length} />
          <Stat label="Track Maps" value={trackMaps.length} />
        </div>

        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">
            Phase 2 — sidebar populated
          </p>
          <p className="mt-1">
            Pick a song, playlist, or track map from the sidebar to
            open it. Phase 3 will add the editor view (drag-drop
            assignment of WAVs to channels, edit-in-place renaming,
            etc.). For now this pane is read-only.
          </p>
        </div>

        {state.error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {state.error}
          </p>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}
