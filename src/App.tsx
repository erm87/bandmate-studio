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
import { AppStateProvider, useAppState, type Selection } from "./state/AppState";
import { EmptyState } from "./components/EmptyState";
import { WorkingFolderBar } from "./components/WorkingFolderBar";
import { Sidebar, SEEDED_TRACKMAP_FILENAMES } from "./components/Sidebar";
import { EditorPane } from "./components/EditorPane";

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}

function Shell() {
  const { state, dispatch, requestClearSelection, requestSelect } =
    useAppState();

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

  // Sidebar arrow-key navigation. ↑/↓ walk through the items in the
  // sidebar section matching the current selection (songs / playlists
  // / track maps). No wrap at section boundaries — ↑ at the first row
  // and ↓ at the last row are silent no-ops.
  //
  // Gating mirrors the ESC chain: only fires when no editor sub-
  // selection is consuming arrows (no channel highlighted in the song
  // editor, no row highlighted in the playlist editor). Also yields
  // to any focused editable surface so inline rename / source-folder
  // input fields can keep using arrows for caret movement.
  //
  // Navigation routes through `requestSelect` so the unsaved-changes
  // guard intercepts when the editor is dirty.
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (state.selection === null) return;
      if (
        state.channelSelection !== null ||
        state.playlistRowSelection !== null
      ) {
        return;
      }
      // Honor any modifier — Cmd/Ctrl/Alt+arrow may belong to a future
      // shortcut, and Shift+arrow is conventionally a selection extend
      // that we don't want to intercept.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
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
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = nextSidebarSelection(state.selection, state.scan, delta);
      if (!next) return;
      e.preventDefault();
      void requestSelect(next);
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [
    state.selection,
    state.channelSelection,
    state.playlistRowSelection,
    state.scan,
    requestSelect,
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

/**
 * Compute the neighbor of the currently-selected sidebar item in the
 * direction `delta` (-1 = up, +1 = down). Returns null if the current
 * selection is at the section boundary (no wrap) or the section is
 * empty.
 *
 * Section order matches the Sidebar's render order:
 *   - songs: alphabetical per the scan
 *   - playlists: alphabetical per the scan
 *   - track maps: seeded (default_tm, stems_tm) first, then user-defined
 */
function nextSidebarSelection(
  selection: Selection,
  scan: { songs: { jcsPath: string }[]; playlists: { path: string }[]; trackMaps: { path: string; filename: string }[] },
  delta: -1 | 1,
): Selection | null {
  switch (selection.kind) {
    case "song": {
      const items = scan.songs;
      const idx = items.findIndex((s) => s.jcsPath === selection.jcsPath);
      const nextIdx = idx + delta;
      if (idx < 0 || nextIdx < 0 || nextIdx >= items.length) return null;
      return { kind: "song", jcsPath: items[nextIdx]!.jcsPath };
    }
    case "playlist": {
      const items = scan.playlists;
      const idx = items.findIndex((p) => p.path === selection.path);
      const nextIdx = idx + delta;
      if (idx < 0 || nextIdx < 0 || nextIdx >= items.length) return null;
      return { kind: "playlist", path: items[nextIdx]!.path };
    }
    case "trackMap": {
      // Match Sidebar's render order: seeded first, then user-defined.
      const seeded = scan.trackMaps.filter((tm) =>
        SEEDED_TRACKMAP_FILENAMES.has(tm.filename),
      );
      const userCreated = scan.trackMaps.filter(
        (tm) => !SEEDED_TRACKMAP_FILENAMES.has(tm.filename),
      );
      const ordered = [...seeded, ...userCreated];
      const idx = ordered.findIndex((tm) => tm.path === selection.path);
      const nextIdx = idx + delta;
      if (idx < 0 || nextIdx < 0 || nextIdx >= ordered.length) return null;
      return { kind: "trackMap", path: ordered[nextIdx]!.path };
    }
  }
}
