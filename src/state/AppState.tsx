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

export interface AppState {
  workingFolder: string | null;
  scan: ScanResult;
  status: AppStatus;
  error: string | null;
}

const EMPTY_SCAN: ScanResult = { songs: [], playlists: [], trackMaps: [] };

const INITIAL_STATE: AppState = {
  workingFolder: null,
  scan: EMPTY_SCAN,
  status: "idle",
  error: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: "scan_started"; path: string }
  | { type: "scan_succeeded"; result: ScanResult }
  | { type: "scan_failed"; error: string }
  | { type: "clear_working_folder" };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "scan_started":
      return {
        ...state,
        workingFolder: action.path,
        status: "loading",
        error: null,
      };
    case "scan_succeeded":
      return {
        ...state,
        scan: action.result,
        status: "ready",
        error: null,
      };
    case "scan_failed":
      return {
        ...state,
        status: "error",
        error: action.error,
      };
    case "clear_working_folder":
      return { ...INITIAL_STATE };
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
