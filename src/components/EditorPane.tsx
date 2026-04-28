/**
 * Right-pane router. Picks an editor based on the current selection.
 *
 *   - No selection      → <WelcomeStub /> (project summary)
 *   - kind: "song"      → <SongEditor />     (Phase 3)
 *   - kind: "playlist"  → <PlaylistEditor /> (Phase 4)
 *   - kind: "trackMap"  → <TrackMapEditor /> (Phase 5)
 *
 * Each editor loads its own data once mounted (we use React's
 * mount/unmount lifecycle, via the `key` prop, to refetch on
 * selection change).
 */

import { useAppState } from "../state/AppState";
import { PlaylistEditor } from "./PlaylistEditor";
import { SongEditor } from "./SongEditor";
import { TrackMapEditor } from "./TrackMapEditor";
import { WelcomeStub } from "./WelcomeStub";

export function EditorPane() {
  const { state } = useAppState();
  const sel = state.selection;

  if (!sel) return <WelcomeStub />;

  switch (sel.kind) {
    case "song":
      return <SongEditor key={sel.jcsPath} jcsPath={sel.jcsPath} />;
    case "playlist":
      return <PlaylistEditor key={sel.path} jcpPath={sel.path} />;
    case "trackMap":
      return <TrackMapEditor key={sel.path} jcmPath={sel.path} />;
  }
}
