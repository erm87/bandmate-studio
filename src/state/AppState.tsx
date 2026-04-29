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
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { ask } from "@tauri-apps/plugin-dialog";

import { initAndScan, pickFolder } from "../fs/workingFolder";
import type { ScanResult } from "../fs/types";
import {
  DEFAULT_USER_PREFS,
  loadUserPrefs,
  loadWorkingFolder,
  saveUserPrefs,
  saveWorkingFolder,
  type UserPrefs,
} from "./persistence";

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
  /** Sticky user preferences from the Settings page. Persisted to localStorage. */
  userPrefs: UserPrefs;
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
  /**
   * Currently-selected song row inside the playlist editor. Same
   * rationale as `channelSelection` — lifted into AppState so the
   * top-level ESC handler can clear it before falling back to
   * clearing the sidebar selection. Used by PlaylistEditor to show
   * inline ↑ ↓ reorder buttons on the highlighted row.
   */
  playlistRowSelection: number | null;
}

const EMPTY_SCAN: ScanResult = { songs: [], playlists: [], trackMaps: [] };

const INITIAL_STATE: AppState = {
  workingFolder: null,
  scan: EMPTY_SCAN,
  status: "idle",
  error: null,
  userPrefs: { ...DEFAULT_USER_PREFS },
  selection: null,
  channelSelection: null,
  playlistRowSelection: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: "scan_started"; path: string }
  | { type: "scan_succeeded"; result: ScanResult }
  | { type: "scan_failed"; error: string }
  | { type: "clear_working_folder" }
  | { type: "set_user_prefs"; prefs: UserPrefs }
  | { type: "select"; selection: Selection }
  | { type: "clear_selection" }
  | { type: "select_channel"; channel: number | null }
  | { type: "select_playlist_row"; row: number | null };

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
      // Preserve userPrefs when forgetting the working folder — these
      // are user-level preferences, not project-scoped state.
      return { ...INITIAL_STATE, userPrefs: state.userPrefs };
    case "set_user_prefs":
      return { ...state, userPrefs: action.prefs };
    case "select":
      // Reset both editor sub-selections when sidebar selection
      // changes — the new editor opens fresh, no carryover highlight.
      return {
        ...state,
        selection: action.selection,
        channelSelection: null,
        playlistRowSelection: null,
      };
    case "clear_selection":
      return {
        ...state,
        selection: null,
        channelSelection: null,
        playlistRowSelection: null,
      };
    case "select_channel":
      return { ...state, channelSelection: action.channel };
    case "select_playlist_row":
      return { ...state, playlistRowSelection: action.row };
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

/**
 * What an editor needs to register so the unsaved-changes guard can
 * intercept nav-aways. Editors call `registerDirtyEditor` from a
 * useEffect that returns the unregister function.
 */
export interface DirtyEditorRegistration {
  /** True if the editor's draft differs from disk. */
  isDirty: () => boolean;
  /**
   * Optional human-readable label for the dialog (e.g. "Buffy" or
   * "May v3.jcp"). Falls back to a generic message if absent.
   */
  label?: string;
}

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;

  /** Show the folder picker; if user picks a path, init + scan + persist. */
  chooseWorkingFolder: () => Promise<void>;
  /** Re-scan the current working folder (e.g. after a file save). */
  rescan: () => Promise<void>;
  /** Forget the current working folder (returns to first-run empty state). */
  clearWorkingFolder: () => void;
  /**
   * Update sticky user preferences. Pass any subset of fields to merge
   * into the current prefs; the rest stay unchanged. Persists to
   * localStorage immediately and updates the in-memory state.
   */
  setUserPrefs: (partial: Partial<UserPrefs>) => void;
  /**
   * Editors call this from a useEffect to advertise their dirty
   * state. Returns an unregister function. Only the most recently
   * registered editor's state is consulted.
   */
  registerDirtyEditor: (reg: DirtyEditorRegistration) => () => void;
  /**
   * Async wrapper around the `select` / `clear_selection` actions.
   * If a registered dirty editor reports unsaved changes, this shows
   * a Discard / Cancel confirm and aborts the navigation if the user
   * cancels. Use these instead of dispatching the raw actions when
   * navigation comes from user input (sidebar click, ESC, etc.).
   */
  requestSelect: (selection: Selection) => Promise<void>;
  /** Companion to `requestSelect` for clearing the current selection. */
  requestClearSelection: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, (s) => ({
    ...s,
    userPrefs: loadUserPrefs(),
  }));

  // Apply colorMode to the document root. For "auto" we listen on the
  // OS-level prefers-color-scheme media query so the theme follows the
  // OS live (e.g., user toggles macOS Appearance from Light to Dark in
  // System Settings — the app picks it up immediately).
  useEffect(() => {
    const root = document.documentElement;
    const mode = state.userPrefs.colorMode;
    if (mode === "light") {
      root.classList.remove("dark");
      return;
    }
    if (mode === "dark") {
      root.classList.add("dark");
      return;
    }
    // mode === "auto"
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (matches: boolean) => {
      if (matches) root.classList.add("dark");
      else root.classList.remove("dark");
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [state.userPrefs.colorMode]);

  const setUserPrefs = useCallback(
    (partial: Partial<UserPrefs>) => {
      const next = { ...state.userPrefs, ...partial };
      saveUserPrefs(next);
      dispatch({ type: "set_user_prefs", prefs: next });
    },
    [state.userPrefs],
  );

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

  // ---- Unsaved-changes guard --------------------------------------------
  //
  // Ref-based registry: the currently-mounted editor reports its
  // dirty status via `registerDirtyEditor`. We only ever have one
  // editor mounted at a time (sidebar selection picks the kind), so
  // a single ref is sufficient. Returning an unregister fn that the
  // editor calls in its cleanup keeps the ref accurate even if a
  // re-render causes a new registration.
  const dirtyEditorRef = useRef<DirtyEditorRegistration | null>(null);

  const registerDirtyEditor = useCallback(
    (reg: DirtyEditorRegistration) => {
      dirtyEditorRef.current = reg;
      return () => {
        if (dirtyEditorRef.current === reg) {
          dirtyEditorRef.current = null;
        }
      };
    },
    [],
  );

  /**
   * Show the unsaved-changes confirm if the registered editor is
   * dirty. Returns true if it's safe to proceed with the navigation
   * (no dirty editor, or user clicked Discard); false to abort.
   */
  const confirmDiscardIfDirty = useCallback(async (): Promise<boolean> => {
    const reg = dirtyEditorRef.current;
    if (!reg || !reg.isDirty()) return true;
    const labelLine = reg.label ? `\n\n"${reg.label}" has unsaved changes.` : "";
    return await ask(
      `You have unsaved changes.${labelLine}\n\nDiscard them and continue? Saving first means cancelling and pressing ⌘S, then navigating again.`,
      {
        title: "Unsaved changes",
        kind: "warning",
        okLabel: "Discard",
        cancelLabel: "Cancel",
      },
    );
  }, []);

  const requestSelect = useCallback(
    async (selection: Selection) => {
      // Re-selecting the already-selected item is a no-op — don't
      // bother prompting.
      const cur = state.selection;
      if (cur && sameSelection(cur, selection)) return;
      const ok = await confirmDiscardIfDirty();
      if (!ok) return;
      dispatch({ type: "select", selection });
    },
    [confirmDiscardIfDirty, state.selection],
  );

  const requestClearSelection = useCallback(async () => {
    if (!state.selection) return;
    const ok = await confirmDiscardIfDirty();
    if (!ok) return;
    dispatch({ type: "clear_selection" });
  }, [confirmDiscardIfDirty, state.selection]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      dispatch,
      chooseWorkingFolder,
      rescan,
      clearWorkingFolder,
      setUserPrefs,
      registerDirtyEditor,
      requestSelect,
      requestClearSelection,
    }),
    [
      state,
      chooseWorkingFolder,
      rescan,
      clearWorkingFolder,
      setUserPrefs,
      registerDirtyEditor,
      requestSelect,
      requestClearSelection,
    ],
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

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** True if two selections refer to the same sidebar item. */
function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "song" && b.kind === "song") return a.jcsPath === b.jcsPath;
  if (a.kind === "playlist" && b.kind === "playlist") return a.path === b.path;
  if (a.kind === "trackMap" && b.kind === "trackMap") return a.path === b.path;
  return false;
}
