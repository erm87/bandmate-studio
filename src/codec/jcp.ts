/**
 * `.jcp` playlist-file codec.
 *
 * On-disk format: same XML-ish dialect as `.jcs`. Schema:
 *
 *   <playlist>
 *     <playlist_display_name>...</playlist_display_name>
 *     <srate>...</srate>
 *     <trackmap>...</trackmap>
 *     <song_name>...</song_name>
 *     ... more <song_name>'s ...
 *   </playlist>
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
  const trackMap = requireString(root.trackmap, "<trackmap>");
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
  lines.push(`    <trackmap>${escapeXml(p.trackMap)}</trackmap>`);
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
