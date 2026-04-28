/**
 * Global app state — Context + reducer.
 *
 * Why this shape: a single reducer for the whole app keeps state
 * transitions explicit and easy to test (just call the reducer with
 * `(state, action)` and assert). Using Context means components don't
 * have to drill props for state access.
 *
 * For v0.1 we have a single store. If state grows we can split into
 * separate contexts (per-feature) later.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import { initAndScan, pickFolder } from "../fs/workingFolder";
import type { ScanResult } from "../fs/types";
import { loadWorkingFolder, saveWorkingFolder } from "./persistence";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type AppStatus =
  | "idle"          // app just opened, no folder yet decided
  | "loading"       // folder picked, scanning
  | "ready"         // scan complete, lists available
  | "error";        // scan failed

/** Identity of the currently-selected sidebar item. */
export type Selection =
  | { kind: "song"; jcsPath: string }
  | { kind: "playlist"; path: string }
  | { kind: "trackMap"; path: string };

export interface AppState {
  workingFolder: string | null;
  scan: ScanResult;
  status: AppStatus;
  error: string | null;
  /** What the user has highlighted in the sidebar (if anything). */
  selection: Selection | null;
  /**
   * Currently-selected channel inside the song editor (0..24) or null.
   * Lives in AppState rather than SongEditor's local state so the
   * top-level ESC handler in `App.tsx` can clear the channel
   * highlight before falling back to clearing the sidebar selection.
   * Reset to null whenever the sidebar selection changes (different
   * song = no carryover highlight).
   */
  channelSelection: number | null;
}

const EMPTY_SCAN: ScanResult = { songs: [], playlists: [], trackMaps: [] };

const INITIAL_STATE: AppState = {
  workingFolder: null,
  scan: EMPTY_SCAN,
  status: "idle",
  error: null,
  selection: null,
  channelSelection: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: "scan_started"; path: string }
  | { type: "scan_succeeded"; result: ScanResult }
  | { type: "scan_failed"; error: string }
  | { type: "clear_working_folder" }
  | { type: "select"; selection: Selection }
  | { type: "clear_selection" }
  | { type: "select_channel"; channel: number | null };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "scan_started":
      return {
        ...state,
        workingFolder: action.path,
        status: "loading",
        error: null,
      };
    case "scan_succeeded": {
      // After a re-scan, if the previously-selected item no longer
      // exists, drop the selection so the editor doesn't show stale
      // content. We bind the narrowed selection to a local in each
      // case branch — TS forgets the discriminator narrowing inside
      // the `.some(...)` lambda closures otherwise.
      const sel = state.selection;
      const stillExists = (() => {
        if (!sel) return false;
        switch (sel.kind) {
          case "song": {
            const target = sel.jcsPath;
            return action.result.songs.some((s) => s.jcsPath === target);
          }
          case "playlist": {
            const target = sel.path;
            return action.result.playlists.some((p) => p.path === target);
          }
          case "trackMap": {
            const target = sel.path;
            return action.result.trackMaps.some((t) => t.path === target);
          }
        }
      })();
      return {
        ...state,
        scan: action.result,
        status: "ready",
        error: null,
        selection: stillExists ? state.selection : null,
      };
    }
    case "scan_failed":
      return {
        ...state,
        status: "error",
        error: action.error,
      };
    case "clear_working_folder":
      return { ...INITIAL_STATE };
    case "select":
      // Reset channel selection when sidebar selection changes —
      // the new editor opens fresh.
      return {
        ...state,
        selection: action.selection,
        channelSelection: null,
      };
    case "clear_selection":
      return { ...state, selection: null, channelSelection: null };
    case "select_channel":
      return { ...state, channelSelection: action.channel };
    default: {
      // Exhaustiveness check — TS will error if we add an action and
      // forget to handle it here.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;

  /** Show the folder picker; if user picks a path, init + scan + persist. */
  chooseWorkingFolder: () => Promise<void>;
  /** Re-scan the current working folder (e.g. after a file save). */
  rescan: () => Promise<void>;
  /** Forget the current working folder (returns to first-run empty state). */
  clearWorkingFolder: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Helper: scan a path and dispatch the appropriate actions. Used by
  // both the initial restore-on-launch and the user-initiated chooser.
  const scanPath = useCallback(async (path: string) => {
    dispatch({ type: "scan_started", path });
    try {
      const result = await initAndScan(path);
      dispatch({ type: "scan_succeeded", result });
      saveWorkingFolder(path);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: "scan_failed", error: message });
      // Don't clear the saved folder on transient errors — Eric may
      // have temporarily disconnected an external drive. He can
      // explicitly clear or re-pick from the UI.
    }
  }, []);

  // On launch, restore the last-used working folder (if any).
  useEffect(() => {
    const saved = loadWorkingFolder();
    if (saved) {
      void scanPath(saved);
    }
  }, [scanPath]);

  const chooseWorkingFolder = useCallback(async () => {
    const path = await pickFolder();
    if (path) {
      await scanPath(path);
    }
  }, [scanPath]);

  const rescan = useCallback(async () => {
    if (state.workingFolder) {
      await scanPath(state.workingFolder);
    }
  }, [scanPath, state.workingFolder]);

  const clearWorkingFolder = useCallback(() => {
    saveWorkingFolder(null);
    dispatch({ type: "clear_working_folder" });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({ state, dispatch, chooseWorkingFolder, rescan, clearWorkingFolder }),
    [state, chooseWorkingFolder, rescan, clearWorkingFolder],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppState must be used within an <AppStateProvider>");
  }
  return ctx;
}

// Re-export for tests / external introspection
export { reducer as _reducerForTests, INITIAL_STATE as _initialStateForTests };
