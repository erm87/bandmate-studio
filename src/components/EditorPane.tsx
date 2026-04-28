/**
 * Right-pane router. Picks an editor based on the current selection.
 *
 * - No selection           → <WelcomeStub /> (project summary, like
 *                             Phase 2's MainPlaceholder)
 * - kind: "song"           → <SongEditor />
 * - kind: "playlist"       → <PlaylistEditorStub />  (Phase 4)
 * - kind: "trackMap"       → <TrackMapEditorStub />   (Phase 5)
 *
 * Editors are responsible for loading their own data once mounted
 * (so we can leverage React's mount/unmount lifecycle to refetch
 * on selection change).
 */

import { useAppState } from "../state/AppState";
import { PlaylistEditor } from "./PlaylistEditor";
import { SongEditor } from "./SongEditor";
import { WelcomeStub } from "./WelcomeStub";

export function EditorPane() {
  const { state } = useAppState();
  const sel = state.selection;

  if (!sel) return <WelcomeStub />;

  switch (sel.kind) {
    case "song":
      // `key` forces remount when the user selects a different song,
      // which keeps the load/cache logic in <SongEditor /> simple.
      return <SongEditor key={sel.jcsPath} jcsPath={sel.jcsPath} />;
    case "playlist":
      // Same `key` trick — remount on selection change so PlaylistEditor's
      // loader runs fresh per .jcp.
      return <PlaylistEditor key={sel.path} jcpPath={sel.path} />;
    case "trackMap":
      return (
        <ComingSoonStub
          title="Track map editor"
          phase="Phase 5"
          path={sel.path}
        />
      );
  }
}

function ComingSoonStub({
  title,
  phase,
  path,
}: {
  title: string;
  phase: string;
  path: string;
}) {
  return (
    <main className="flex flex-1 flex-col overflow-y-auto bg-white p-12 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">
          {title} — coming in {phase}
        </p>
        <p className="mt-1">
          For now, the file at{" "}
          <span className="user-text font-mono text-xs">{path}</span> is read
          by BandMate Studio's codec but not yet rendered as an editor. You
          can still edit the file manually in any text editor — see SPEC.md
          for the format.
        </p>
      </div>
    </main>
  );
}
