/**
 * Sticky settings persistence.
 *
 * We use localStorage because (a) it's reliable across launches in the
 * macOS WKWebView Tauri uses, and (b) it has zero setup cost (no
 * additional Tauri plugins). If we outgrow it (we won't for v0.1)
 * we can migrate to tauri-plugin-store without changing call sites.
 *
 * Keys are namespaced under "bandmate-studio." to avoid collisions if
 * the webview is ever reused for another app.
 */

const KEY_PREFIX = "bandmate-studio.";

const KEYS = {
  workingFolder: `${KEY_PREFIX}workingFolder`,
  userPrefs: `${KEY_PREFIX}userPrefs`,
} as const;

export function loadWorkingFolder(): string | null {
  try {
    return localStorage.getItem(KEYS.workingFolder);
  } catch {
    // localStorage may be unavailable in private-mode webviews; treat
    // as no saved folder rather than crashing.
    return null;
  }
}

export function saveWorkingFolder(path: string | null): void {
  try {
    if (path === null) {
      localStorage.removeItem(KEYS.workingFolder);
    } else {
      localStorage.setItem(KEYS.workingFolder, path);
    }
  } catch {
    // Persist-best-effort: if localStorage write fails, the user just
    // re-picks the folder next launch. Not worth surfacing an error.
  }
}

// ---------------------------------------------------------------------------
// User preferences (Settings page)
// ---------------------------------------------------------------------------

export type ColorMode = "light" | "dark" | "auto";
export type DefaultSampleRate = 44100 | 48000;

export interface UserPrefs {
  /** Light / Dark / Auto (follow OS). */
  colorMode: ColorMode;
  /**
   * Pre-fills the sample-rate selector in NewSongDialog and
   * NewPlaylistDialog. The codec only supports 44.1k / 48k for now,
   * so we constrain to those.
   */
  defaultSampleRate: DefaultSampleRate;
  /**
   * When true, MIDI files copied into a song folder are automatically
   * cleaned (non-essential meta events stripped — see Rust midi.rs).
   * Off by default. When the user toggles this on, the Settings page
   * also offers to retroactively clean MIDI files already in their
   * song folders. Source-folder MIDI files are never touched.
   */
  cleanMidiOnImport: boolean;
  /**
   * Filename (not full path) of the user's preferred track map for
   * new songs / playlists. The NewSongDialog and NewPlaylistDialog
   * pre-select this in their track-map picker. Stored as a filename
   * (e.g. "default_tm.jcm", "Diff_Test_tm.jcm") so it survives
   * working-folder moves and reflects the on-disk identity. Falls
   * back to "default_tm.jcm" (seeded by Studio's init) if the named
   * file no longer exists in the current working folder.
   */
  defaultTrackMapJcm: string;
  /**
   * Sticky default USB export destination. When set, ExportToUsbDialog
   * pre-selects this path and jumps to the "confirm" step on open,
   * unless `state.lastExportDestPath` (session memory) is set — that
   * wins because it reflects a more recent explicit choice. If neither
   * applies or the saved path doesn't exist (stick unplugged), falls
   * through to the picker. Most bands export to the same physical
   * stick week after week so setting this once removes the picker
   * friction across app launches.
   *
   * Stored as an absolute filesystem path (e.g. "/Volumes/BANDMATE").
   * Empty string / undefined = no default set.
   */
  defaultExportDestPath: string;
  /**
   * When true, USB export only copies audio / MIDI files that are
   * referenced by at least one song's `.jcs`. Unused takes left
   * behind in song folders from previous Logic exports are skipped,
   * saving stick space + copy time. `.jcs` / `.jcp` / `.jcm` files
   * always ship regardless of this setting (they're definitions,
   * not media).
   *
   * Default is `false` — the live-rig reliability principle says
   * we don't change export semantics by default. Users opt in
   * once they understand their song folders accumulate cruft.
   */
  exportOnlyReferencedFiles: boolean;
  /**
   * When true (default), the "Import all" button on the Source
   * Folder tab tries to match each file to a track-map channel
   * by name (fuzzy match via `src/lib/sourceMatch.ts`) and assigns
   * the match automatically; unmatched files copy into the song
   * folder without channel assignment. When false, Import all
   * skips the fuzzy matcher entirely — every file is copied into
   * the song folder, no channel assignments are made.
   *
   * The auto-update-existing-channels feature gates on this same
   * flag (see BACKLOG.md). When off, no auto-replacement dialogs
   * appear either.
   *
   * Default `true` preserves the current behavior for existing
   * users. Off is the right setting for users whose filenames
   * don't line up with their track-map labels and the fuzzy
   * matcher's guesses are net-negative.
   */
  smartMappingEnabled: boolean;
}

export const DEFAULT_USER_PREFS: UserPrefs = {
  colorMode: "auto",
  defaultSampleRate: 48000,
  cleanMidiOnImport: false,
  // Seeded by init_working_folder; safe to reference even in a fresh
  // working folder. Consumers fall back gracefully if missing.
  defaultTrackMapJcm: "default_tm.jcm",
  // Empty string = no sticky default; export dialog uses the picker.
  defaultExportDestPath: "",
  // Off by default — full-copy stays the safe baseline.
  exportOnlyReferencedFiles: false,
  // On by default — preserves the fuzzy-match behavior that
  // shipped with Import all. Users can opt out if it's net-negative
  // for their filenames.
  smartMappingEnabled: true,
};

/**
 * Load user preferences from localStorage. Unknown / malformed data
 * falls back to defaults — never throws. Forward-compatible: missing
 * keys in the stored blob get filled in from `DEFAULT_USER_PREFS`,
 * so adding a new pref doesn't break existing installs.
 */
export function loadUserPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(KEYS.userPrefs);
    if (!raw) return { ...DEFAULT_USER_PREFS };
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      colorMode: isColorMode(parsed.colorMode)
        ? parsed.colorMode
        : DEFAULT_USER_PREFS.colorMode,
      defaultSampleRate: isDefaultSampleRate(parsed.defaultSampleRate)
        ? parsed.defaultSampleRate
        : DEFAULT_USER_PREFS.defaultSampleRate,
      cleanMidiOnImport:
        typeof parsed.cleanMidiOnImport === "boolean"
          ? parsed.cleanMidiOnImport
          : DEFAULT_USER_PREFS.cleanMidiOnImport,
      defaultTrackMapJcm:
        typeof parsed.defaultTrackMapJcm === "string" &&
        parsed.defaultTrackMapJcm.length > 0
          ? parsed.defaultTrackMapJcm
          : DEFAULT_USER_PREFS.defaultTrackMapJcm,
      defaultExportDestPath:
        typeof parsed.defaultExportDestPath === "string"
          ? parsed.defaultExportDestPath
          : DEFAULT_USER_PREFS.defaultExportDestPath,
      exportOnlyReferencedFiles:
        typeof parsed.exportOnlyReferencedFiles === "boolean"
          ? parsed.exportOnlyReferencedFiles
          : DEFAULT_USER_PREFS.exportOnlyReferencedFiles,
      smartMappingEnabled:
        typeof parsed.smartMappingEnabled === "boolean"
          ? parsed.smartMappingEnabled
          : DEFAULT_USER_PREFS.smartMappingEnabled,
    };
  } catch {
    return { ...DEFAULT_USER_PREFS };
  }
}

export function saveUserPrefs(prefs: UserPrefs): void {
  try {
    localStorage.setItem(KEYS.userPrefs, JSON.stringify(prefs));
  } catch {
    // best-effort
  }
}

function isColorMode(v: unknown): v is ColorMode {
  return v === "light" || v === "dark" || v === "auto";
}

function isDefaultSampleRate(v: unknown): v is DefaultSampleRate {
  return v === 44100 || v === 48000;
}
