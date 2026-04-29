/**
 * `.jcp` playlist-file codec.
 *
 * On-disk format: same XML-ish dialect as `.jcs`. Schema:
 *
 *   <playlist>
 *     <playlist_display_name>...</playlist_display_name>
 *     <srate>...</srate>
 *     <trackmap>...</trackmap>          (optional — omitted when empty)
 *     <song_name>...</song_name>
 *     ... more <song_name>'s ...
 *   </playlist>
 *
 * `<trackmap>` parity with BM Loader (audited 2026-04-28 against the
 * decompiled `savePlaylist` / `loadPlaylist` in playlistparse.pyc):
 *   - BM Loader's writer emits the element only when the trackmap
 *     filename is non-empty (`if trackmap != '': ...`).
 *   - BM Loader's reader wraps the find in try/except and treats a
 *     missing element as `trackMapExists = False`.
 * Our codec mirrors this: `parsePlaylist` accepts a missing or empty
 * `<trackmap>` and returns `trackMap: ""`; `writePlaylist` omits the
 * element when `trackMap` is empty.
 *
 * See SPEC.md for full format reference.
 */

import { XMLParser } from "fast-xml-parser";
import type { Playlist } from "./types";

const parser = new XMLParser({
  isArray: (name) => name === "song_name",
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: true,
  trimValues: true,
});

/**
 * Parse the contents of a `.jcp` file into a `Playlist`.
 */
export function parsePlaylist(text: string): Playlist {
  const parsed = parser.parse(text);
  const root = parsed?.playlist;
  if (!root || typeof root !== "object") {
    throw new Error("Invalid .jcp file: missing <playlist> root element");
  }

  const displayName = requireString(
    root.playlist_display_name,
    "<playlist_display_name>",
  );
  const sampleRate = parseIntStrict(root.srate, "<srate>");
  // `<trackmap>` is optional in BM Loader's format — see file header.
  // Missing element → "", empty element → "". The PlaylistEditor surfaces
  // a validation warning when trackMap is "".
  const trackMap = optionalString(root.trackmap);
  const rawNames = (root.song_name ?? []) as unknown[];
  const songNames = rawNames.map((n, idx) => {
    if (typeof n !== "string") {
      throw new Error(`<song_name>[${idx}] not a string`);
    }
    return n;
  });

  return { displayName, sampleRate, trackMap, songNames };
}

/**
 * Serialize a `Playlist` to a `.jcp` string.
 *
 * Output format matches stock BM Loader: 4-space indent, LF line
 * endings, trailing newline after `</playlist>`, element order is
 * `<playlist_display_name>`, `<srate>`, `<trackmap>`, then song names
 * in playlist order.
 */
export function writePlaylist(p: Playlist): string {
  const lines: string[] = [];
  lines.push("<playlist>");
  lines.push(
    `    <playlist_display_name>${escapeXml(p.displayName)}</playlist_display_name>`,
  );
  lines.push(`    <srate>${p.sampleRate}</srate>`);
  // BM Loader omits <trackmap> when empty — match it.
  if (p.trackMap !== "") {
    lines.push(`    <trackmap>${escapeXml(p.trackMap)}</trackmap>`);
  }
  for (const name of p.songNames) {
    lines.push(`    <song_name>${escapeXml(name)}</song_name>`);
  }
  lines.push("</playlist>");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from jcs.ts; small enough to keep colocated)
// ---------------------------------------------------------------------------

function parseIntStrict(value: unknown, field: string): number {
  if (value === undefined || value === null) {
    throw new Error(`Missing required field ${field}`);
  }
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Field ${field} not an integer: ${JSON.stringify(value)}`);
  }
  return n;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required string field ${field}`);
  }
  return value;
}

/**
 * For elements that BM Loader treats as optional (e.g. `<trackmap>`).
 * Missing → "". Empty element parses as "" too. Non-string parsed
 * shape (shouldn't happen given XMLParser config, but defend) → "".
 */
function optionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "";
  return value;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
