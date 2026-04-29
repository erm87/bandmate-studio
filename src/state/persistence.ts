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
}

export const DEFAULT_USER_PREFS: UserPrefs = {
  colorMode: "auto",
  defaultSampleRate: 48000,
  cleanMidiOnImport: false,
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
