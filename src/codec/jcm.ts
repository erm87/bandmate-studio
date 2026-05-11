/**
 * `.jcm` track-map codec.
 *
 * On-disk format: plain text, one channel label per line, 25 lines total
 * (24 audio + 1 MIDI). Unused channels are empty lines.
 *
 * Line-ending convention (audited 2026-05-11 against modern BM Loader
 * output, smoke-test finding F-3):
 *   - Our reader accepts CRLF, LF, or mixed — be liberal.
 *   - Our writer emits LF separators WITH a trailing newline. This
 *     matches what current BM Loader writes when the user creates a new
 *     trackmap in its UI.
 *   - The legacy fixtures in `__fixtures__/` (`default_tm.jcm`,
 *     `stems_tm.jcm`) use CRLF without trailing newline — they're
 *     BM Loader's bundled stock templates, written in an older
 *     convention. Studio's `init_working_folder` seeds these
 *     byte-for-byte (CRLF), but anything the user CREATES or EDITS
 *     goes through `writeTrackMap` below and gets the LF convention.
 *
 * Both conventions are interchangeable on the wire — the BandMate's
 * loader is lenient. The dual-convention split is purely about byte-
 * level parity with the two file sources (bundled stock vs. user-
 * authored).
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
 * Uses LF separators WITH a trailing newline. Matches modern BM Loader
 * output for user-created trackmaps (smoke-test finding F-3).
 */
export function writeTrackMap(map: TrackMap): string {
  if (map.channels.length !== TRACK_MAP_CHANNEL_COUNT) {
    throw new Error(
      `TrackMap must have exactly ${TRACK_MAP_CHANNEL_COUNT} channels, got ${map.channels.length}`,
    );
  }
  return map.channels.join("\n") + "\n";
}
