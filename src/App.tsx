/**
 * BandMate Studio — top-level layout.
 *
 * Two states:
 *   - No working folder yet: full-screen <EmptyState> with a single CTA.
 *   - Working folder set:    top bar + left sidebar + right pane.
 *
 * Phase 2 ships the empty state, working-folder bar, and three-list
 * sidebar. The right pane is a read-only summary (<MainPlaceholder>);
 * Phase 3 replaces it with real editors.
 */

import { AppStateProvider, useAppState } from "./state/AppState";
import { EmptyState } from "./components/EmptyState";
import { WorkingFolderBar } from "./components/WorkingFolderBar";
import { Sidebar } from "./components/Sidebar";
import { MainPlaceholder } from "./components/MainPlaceholder";

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}

function Shell() {
  const { state } = useAppState();

  // Show empty state until the user has chosen a folder. We also fall
  // back to it if there's an error AND no scan results yet (e.g. the
  // restored path doesn't exist anymore).
  const hasFolder = state.workingFolder !== null;
  if (!hasFolder) {
    return <EmptyState />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <WorkingFolderBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainPlaceholder />
      </div>
    </div>
  );
}
