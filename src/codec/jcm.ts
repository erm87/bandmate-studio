/**
 * `.jcm` track-map codec.
 *
 * On-disk format: plain text, one channel label per line, 25 lines total
 * (24 audio + 1 MIDI). Unused channels are empty lines. Stock JoeCo files
 * use CRLF without trailing newline; user-edited files (Eric's
 * erictest_tm.jcm) use LF with trailing newline. Our reader accepts either;
 * our writer emits CRLF without trailing newline (matches stock).
 *
 * See SPEC.md for the byte-level format reference.
 */

import { TRACK_MAP_CHANNEL_COUNT, type TrackMap } from "./types";

/**
 * Parse the contents of a `.jcm` file into a `TrackMap`.
 *
 * Strict-ish: pads to exactly 25 channels by appending empty strings if
 * the file is short, and truncates if it has more than 25 lines (rare —
 * we warn but don't throw, to be lenient with hand-edited files).
 */
export function parseTrackMap(text: string): TrackMap {
  // Normalize line endings: split on either CRLF or LF.
  const rawLines = text.split(/\r\n|\r|\n/);

  // Strip a single trailing empty line that's an artifact of a
  // trailing newline (e.g., file ends with `Kemper\n` → split yields
  // ['...', 'Kemper', ''] and we want the empty discarded).
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  // Pad / trim to exactly 25 entries.
  const channels = [...rawLines];
  while (channels.length < TRACK_MAP_CHANNEL_COUNT) {
    channels.push("");
  }
  if (channels.length > TRACK_MAP_CHANNEL_COUNT) {
    channels.length = TRACK_MAP_CHANNEL_COUNT;
  }

  return { channels };
}

/**
 * Serialize a `TrackMap` to a `.jcm` string.
 *
 * Uses CRLF separators with no trailing newline (matches stock JoeCo
 * default_tm.jcm / stems_tm.jcm). The BandMate hardware accepts either
 * convention.
 */
export function writeTrackMap(map: TrackMap): string {
  if (map.channels.length !== TRACK_MAP_CHANNEL_COUNT) {
    throw new Error(
      `TrackMap must have exactly ${TRACK_MAP_CHANNEL_COUNT} channels, got ${map.channels.length}`,
    );
  }
  return map.channels.join("\r\n");
}
