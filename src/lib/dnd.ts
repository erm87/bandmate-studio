/**
 * Drag-and-drop payload helpers.
 *
 * We use the native HTML5 drag-and-drop API directly — no library.
 *
 * Four payload shapes today:
 *   - `source-file`:    a WAV or MIDI from the SourceFilesPane
 *   - `channel-move`:   move an existing assignment to another channel
 *   - `playlist-row`:   reorder within the PlaylistEditor's song list
 *   - `available-song`: a song from AvailableSongsPane onto the playlist
 *
 * ## WebKit (WKWebView) note
 *
 * Tauri uses WKWebView on macOS. WebKit restricts custom MIME types
 * in `DataTransfer.types` during `dragenter` and `dragover` events —
 * the data is still readable on `drop`, but `types` only exposes a
 * narrow allowlist (text/plain, text/uri-list, etc.). This means a
 * custom-type-only payload can't gate dragOver via `types` checks:
 * `hasBmsPayload` would return false during dragOver, `preventDefault`
 * wouldn't run, and `drop` would never fire.
 *
 * Workaround used here: we dual-write the JSON payload to both our
 * custom type AND `text/plain`, and on the receive side we accept
 * either. Drop handlers should also always `preventDefault` rather
 * than gating on `hasBmsPayload` — the drop validates by trying to
 * read either type and silently no-ops if the JSON doesn't parse.
 *
 * Add new variants by extending the `BmsDragPayload` union; the
 * setPayload / readPayload helpers handle the dual-write transparently.
 */

import type { AudioFileInfo } from "../fs/types";

/** Custom MIME type — must match between setPayload and readPayload. */
export const BMS_DRAG_TYPE = "application/x-bandmate-studio";
/**
 * Marker prefix for the text/plain copy. Lets us distinguish our
 * fallback payloads from genuine external text drags.
 */
const TEXT_PLAIN_PREFIX = "BMS_DRAG:";

export type BmsDragPayload =
  | { kind: "source-file"; file: AudioFileInfo }
  | { kind: "channel-move"; sourceChannel: number }
  | { kind: "playlist-row"; from: number }
  | { kind: "available-song"; folderName: string }
  | { kind: "trackmap-row"; from: number };

/**
 * Serialize a payload onto a DataTransfer object. Call from `onDragStart`.
 *
 * Sets the payload on BOTH the custom MIME type and text/plain (with
 * a marker prefix) so receivers work even when WebKit hides custom
 * types during dragover. Also sets `effectAllowed` so the browser's
 * default drop UI matches our intent.
 */
export function setDragPayload(
  e: React.DragEvent,
  payload: BmsDragPayload,
): void {
  const json = JSON.stringify(payload);
  try {
    e.dataTransfer.setData(BMS_DRAG_TYPE, json);
  } catch {
    // Some implementations throw on unknown types; ignore — text/plain
    // is our reliable fallback.
  }
  try {
    e.dataTransfer.setData("text/plain", TEXT_PLAIN_PREFIX + json);
  } catch {
    // text/plain should always succeed, but defensive.
  }
  e.dataTransfer.effectAllowed =
    payload.kind === "playlist-row" ||
    payload.kind === "channel-move" ||
    payload.kind === "trackmap-row"
      ? "move"
      : "copy";
}

/**
 * Read the BMS payload off a DataTransfer object, or `null` if the
 * drag didn't originate from our app (e.g., a Finder file drop or a
 * plain-text selection from outside).
 *
 * Tries the custom type first, then falls back to text/plain (after
 * stripping the marker prefix). Validates the parsed shape so a
 * genuine external text drag can't impersonate our payload.
 *
 * Safe to call only during `onDrop` — `getData` returns "" in dragOver.
 */
export function readDragPayload(e: React.DragEvent): BmsDragPayload | null {
  let raw = "";
  try {
    raw = e.dataTransfer.getData(BMS_DRAG_TYPE);
  } catch {
    /* swallow */
  }
  if (!raw) {
    let textPlain = "";
    try {
      textPlain = e.dataTransfer.getData("text/plain");
    } catch {
      /* swallow */
    }
    if (textPlain.startsWith(TEXT_PLAIN_PREFIX)) {
      raw = textPlain.slice(TEXT_PLAIN_PREFIX.length);
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "kind" in parsed &&
      typeof (parsed as { kind: unknown }).kind === "string"
    ) {
      return parsed as BmsDragPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cheap check during `onDragOver` / `onDragEnter`: does this drag
 * appear to be one of ours? Used for visual affordances (highlighting
 * a drop target).
 *
 * Note: WebKit hides custom MIME types during dragover, so this falls
 * back to checking for `text/plain` (our dual-write fallback type). It
 * may return `true` for genuine external text drags too — accept the
 * false positive; the actual drop handler validates payload shape and
 * silently no-ops on mismatch. Drop handlers should NOT gate
 * `preventDefault` on this — always allow drop and validate in onDrop.
 */
export function hasBmsPayload(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types);
  return types.includes(BMS_DRAG_TYPE) || types.includes("text/plain");
}

/**
 * Set a custom drag image — a small pill showing just the dragged
 * item's name — instead of the browser's default (a screenshot of
 * the entire dragged element, which would include channel #, lvl,
 * pan etc. for a channel row).
 *
 * Implementation: render a styled div off-screen, point setDragImage
 * at it, then schedule its removal. setDragImage rasterizes the
 * element synchronously so the DOM node can be detached immediately
 * after — but we use `requestAnimationFrame` for a touch of safety
 * across engines.
 *
 * Call this from `onDragStart` AFTER `setDragPayload`.
 */
export function setDragImageLabel(e: React.DragEvent, label: string): void {
  if (!label) return;
  const ghost = document.createElement("div");
  ghost.textContent = label;
  // Inline styles so we don't depend on Tailwind class availability;
  // also keeps the ghost looking the same in light + dark mode (the
  // element renders before the user's eye registers theme).
  ghost.style.cssText = [
    "position: fixed",
    "top: -9999px",
    "left: -9999px",
    // Compact: 18-20px tall, narrow, so it doesn't obscure the
    // dropzone labels we render on the row beneath the cursor.
    "padding: 3px 8px",
    "background: #ffffff",
    "color: #18181b",
    "font: 600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    "border: 1px solid rgb(212, 212, 216)",
    "border-radius: 4px",
    "box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15)",
    "white-space: nowrap",
    "max-width: 200px",
    "overflow: hidden",
    "text-overflow: ellipsis",
    "pointer-events: none",
    "z-index: 9999",
  ].join("; ");
  document.body.appendChild(ghost);
  // Offset puts the ghost slightly down-right of the cursor — feels
  // like the ghost is "trailing" the pointer rather than under it.
  e.dataTransfer.setDragImage(ghost, 12, 16);
  // Detach next tick — by then the rasterized image is in flight.
  requestAnimationFrame(() => {
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
  });
}
