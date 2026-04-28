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
