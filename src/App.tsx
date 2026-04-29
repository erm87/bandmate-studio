/**
 * BandMate Studio — top-level layout.
 *
 * Two states:
 *   - No working folder yet: full-screen <EmptyState> with a single CTA.
 *   - Working folder set:    top bar + left sidebar + right pane.
 *
 * Phase 2 ships the empty state, working-folder bar, and three-list
 * sidebar. Phase 3 adds selection wiring and the Song editor.
 *
 * Global keybindings:
 *   - ESC clears the current selection (returns to the project-summary
 *     stub on the right).
 */

import { useEffect } from "react";
import { AppStateProvider, useAppState } from "./state/AppState";
import { EmptyState } from "./components/EmptyState";
import { WorkingFolderBar } from "./components/WorkingFolderBar";
import { Sidebar } from "./components/Sidebar";
import { EditorPane } from "./components/EditorPane";

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}

function Shell() {
  const { state, dispatch, requestClearSelection } = useAppState();

  // ESC clears the editor's channel highlight first, then falls back to
  // clearing the sidebar selection. Skipped if focus is in an input
  // so it doesn't fight inline editing.
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }
      // ESC chain: editor sub-selections first (channel highlight in
      // SongEditor, song-row highlight in PlaylistEditor), then the
      // sidebar selection. Channel and playlist-row are mutually
      // exclusive — at most one editor is mounted at a time.
      //
      // The sidebar-selection clear goes through requestClearSelection
      // so the unsaved-changes guard can intercept (the sub-selection
      // clears are local affordances, no guard needed).
      if (state.channelSelection !== null) {
        dispatch({ type: "select_channel", channel: null });
      } else if (state.playlistRowSelection !== null) {
        dispatch({ type: "select_playlist_row", row: null });
      } else if (state.selection !== null) {
        void requestClearSelection();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [
    state.selection,
    state.channelSelection,
    state.playlistRowSelection,
    dispatch,
    requestClearSelection,
  ]);

  // Show empty state until the user has chosen a folder. We also fall
  // back to it if there's an error AND no scan results yet (e.g. the
  // restored path doesn't exist anymore).
  const hasFolder = state.workingFolder !== null;
  if (!hasFolder) {
    return <EmptyState />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <WorkingFolderBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <EditorPane />
      </div>
    </div>
  );
}
