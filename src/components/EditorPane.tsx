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
 * selection change). The wrapper div carries `view-transition-name`
 * so the browser crossfades the editor pane on selection change
 * instead of hard-cutting through the unmount/remount; see
 * `lib/viewTransition.ts` for the wiring.
 */

import type { ReactNode } from "react";
import { useAppState } from "../state/AppState";
import { PlaylistEditor } from "./PlaylistEditor";
import { SongEditor } from "./SongEditor";
import { TrackMapEditor } from "./TrackMapEditor";
import { WelcomeStub } from "./WelcomeStub";

export function EditorPane() {
  const { state } = useAppState();
  const sel = state.selection;

  let content: ReactNode;
  if (!sel) {
    content = <WelcomeStub />;
  } else {
    switch (sel.kind) {
      case "song":
        content = <SongEditor key={sel.jcsPath} jcsPath={sel.jcsPath} />;
        break;
      case "playlist":
        content = <PlaylistEditor key={sel.path} jcpPath={sel.path} />;
        break;
      case "trackMap":
        content = <TrackMapEditor key={sel.path} jcmPath={sel.path} />;
        break;
    }
  }

  // The wrapper persists across selection changes (no `key`) so its
  // identity is stable — required for the browser to scope the view
  // transition to this region. The inner editors still unmount /
  // remount per their own `key` (their data load semantics depend on
  // it), but the crossfade smooths the visual cut.
  return (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
      style={{ viewTransitionName: "editor-pane" }}
    >
      {content}
    </div>
  );
}
